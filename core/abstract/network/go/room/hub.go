// Package room: 真实房间服务 — 复用 M1.5 协议语义,支持多连接 + 4 人硬约束 + 20Hz tick 钩子。
//
// 关键约束(来自项目方案 §5.4):
//   - 4 人小队上限(1 主机 + 3 队友):第 5 人加入返回 ROOM_ERROR_FULL
//   - 20Hz tick:tickLoop 每 50ms 调用一次 onTick 钩子(M2.1 接入玩家输入)
//   - 5 分钟断线保留:玩家断线后保留 slot 5 分钟,超时生成"离线墓碑"
//
// 业务逻辑继承自 mocks.MockServer(M1.5 已对齐协议层互通),
// 区别:mocks 是单连接;room.Hub 支持 N 个连接跨房间广播。
package room

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	"github.com/wildwood/net/transport"
)

// MaxPlayersPerRoom 硬约束(方案 §5.4)
const MaxPlayersPerRoom = 4

// Hub 房间注册表 + 玩家注册表
type Hub struct {
	mu        sync.RWMutex
	rooms     map[string]*Room
	players   map[string]*Player
	playerSeq atomic.Uint32 // 独立:玩家 id 自增 (p-NNN)
	roomSeq   atomic.Uint32 // 独立:房间 id 自增 (r-NNNNN) 5 位短链
	tokenSeq  atomic.Uint32 // 独立:join_token 自增 (t-NNNNN)
	tickHz    int
	onTick    func(tick uint32, r *Room)
	stop      chan struct{}
	wg        sync.WaitGroup

	// M2.11 codex 5Hz ticker(独立于 20Hz 主 tick)
	codexStop chan struct{}
	codexWG   sync.WaitGroup
}

// NewHub 构造房间中心
func NewHub(tickHz int) *Hub {
	if tickHz <= 0 {
		tickHz = 20
	}
	return &Hub{
		rooms:     make(map[string]*Room),
		players:   make(map[string]*Player),
		tickHz:    tickHz,
		stop:      make(chan struct{}),
		codexStop: make(chan struct{}),
	}
}

// Mu 暴露互斥锁(给 server.onDisconnect 用,简化 API)
//
// Deprecated: 业务上不应直接持锁,应通过公开方法操作。
func (h *Hub) Mu() *sync.RWMutex { return &h.mu }

// Players 返回玩家注册表(只读引用;主调方不应修改)
func (h *Hub) Players() map[string]*Player { return h.players }

// Rooms 返回房间注册表
func (h *Hub) Rooms() map[string]*Room { return h.rooms }

// ForceLeave 强制把玩家从房间移除(用于断线清理;不走协议帧)
func (h *Hub) ForceLeave(playerID, roomID string) {
	h.mu.Lock()
	r, ok := h.rooms[roomID]
	if !ok {
		h.mu.Unlock()
		return
	}
	r.RemoveMember(playerID)
	p, pok := h.players[playerID]
	roomEmpty := r.MemberCount() == 0
	if roomEmpty {
		delete(h.rooms, roomID)
	}
	h.mu.Unlock()
	if pok {
		p.RoomID = ""
	}
}

// SetTickHook 设置 tick 钩子(测试或上层业务用)
func (h *Hub) SetTickHook(fn func(tick uint32, r *Room)) { h.onTick = fn }

// Start 启动 20Hz tick 循环 + 5Hz codex ticker(M2.11)
func (h *Hub) Start() {
	h.wg.Add(1)
	go h.tickLoop()
	h.codexWG.Add(1)
	go h.codexTickerLoop()
}

// Stop 停止所有 ticker
func (h *Hub) Stop() {
	close(h.stop)
	close(h.codexStop)
	h.wg.Wait()
	h.codexWG.Wait()
}

// tickLoop 20Hz 主 tick
func (h *Hub) tickLoop() {
	defer h.wg.Done()
	interval := time.Second / time.Duration(h.tickHz)
	t := time.NewTicker(interval)
	defer t.Stop()
	var tick uint32
	for {
		select {
		case <-h.stop:
			return
		case <-t.C:
			tick++
			h.mu.RLock()
			rooms := make([]*Room, 0, len(h.rooms))
			for _, r := range h.rooms {
				rooms = append(rooms, r)
			}
			h.mu.RUnlock()
			if h.onTick != nil {
				for _, r := range rooms {
					h.onTick(tick, r)
				}
			}
		}
	}
}

// codexTickerLoop 5Hz 独立 ticker(M2.11 简化版)
// 扫所有房间 dirty 集,有 dirty 才广播 S2C_CodexDelta
// 字节预算:典型 4-50 unlocked < 256B
// M3.1 协议统辖后,会改为挂 WorldDelta 走 20Hz 主通道
func (h *Hub) codexTickerLoop() {
	defer h.codexWG.Done()
	t := time.NewTicker(CodexTickInterval)
	defer t.Stop()
	var tick uint32
	for {
		select {
		case <-h.codexStop:
			return
		case <-t.C:
			tick++
			h.mu.RLock()
			rooms := make([]*Room, 0, len(h.rooms))
			for _, r := range h.rooms {
				rooms = append(rooms, r)
			}
			h.mu.RUnlock()
			nowMs := uint64(time.Now().UnixMilli())
			for _, r := range rooms {
				if !r.codex.HasDirty() {
					continue
				}
				_ = r.codex.DrainDirty() // 清空 dirty
				unlocked := r.codex.SnapshotUnlocked()
				if len(unlocked) == 0 {
					continue
				}
				r.Broadcast(encodeFrame("S2C_CodexDelta", BuildCodexDelta(tick, nowMs, unlocked)))
			}
		}
	}
}

// UnlockCodex 钩子(单点接入 — M2.2/M2.9/M2.10/M2.13 调用本方法)
//   - 幂等:已解锁则 no-op
//   - 写完后由 5Hz ticker 在 ≤200ms 内广播给全队
//   - 若 playerID 未在房间(可能已断线),静默忽略
func (h *Hub) UnlockCodex(playerID, entryID string) bool {
	if entryID == "" {
		return false
	}
	h.mu.RLock()
	p, pok := h.players[playerID]
	var r *Room
	if pok && p.RoomID != "" {
		r = h.rooms[p.RoomID]
	}
	h.mu.RUnlock()
	if !pok || r == nil {
		return false
	}
	nowMs := uint64(time.Now().UnixMilli())
	return r.codex.Unlock(entryID, nowMs)
}

// RegisterPlayer 玩家首次握手时注册,返回 player_id + session_token
func (h *Hub) RegisterPlayer(playerName string) (string, string) {
	pid := h.nextPlayerID()
	p := &Player{
		ID:       pid,
		Name:     playerName,
		JoinedAt: time.Now(),
	}
	h.mu.Lock()
	h.players[pid] = p
	h.mu.Unlock()
	return pid, fmt.Sprintf("sess-%s", pid)
}

// Handle 把 C2S 消息分发到对应的 handler
//
// conn 必须是 transport.Conn(已注入 playerID 或未认证)
func (h *Hub) Handle(conn *transport.Conn, msg proto.Message) error {
	switch m := msg.(type) {
	case *wildwoodv1.C2S_Handshake:
		return h.handleHandshake(conn, m)
	case *wildwoodv1.C2S_Heartbeat:
		return h.handleHeartbeat(conn, m)
	case *wildwoodv1.C2S_RoomCreate:
		return h.handleRoomCreate(conn, m)
	case *wildwoodv1.C2S_RoomJoin:
		return h.handleRoomJoin(conn, m)
	case *wildwoodv1.C2S_RoomLeave:
		return h.handleRoomLeave(conn, m)
	case *wildwoodv1.C2S_RoomKick:
		return h.handleRoomKick(conn, m)
	case *wildwoodv1.C2S_RoomList:
		return h.handleRoomList(conn)
	case *wildwoodv1.C2S_PlayerInput:
		return h.handlePlayerInput(conn, m)
	case *wildwoodv1.C2S_ChatMsg:
		return h.handleChat(conn, m)
	case *wildwoodv1.C2S_Disconnect:
		_ = conn.Close()
		return nil
	case *wildwoodv1.C2S_CodexQuery:
		return h.handleCodexQuery(conn, m)
	case *wildwoodv1.C2S_CodexView:
		return h.handleCodexView(conn, m)
	}
	return fmt.Errorf("hub: unhandled C2S message type %T", msg)
}

// ===========================
// Handler 实现
// ===========================

func (h *Hub) handleHandshake(conn *transport.Conn, m *wildwoodv1.C2S_Handshake) error {
	// Handshake 之前必须未认证
	if _, ok := conn.GetPlayerID(); ok {
		// 已认证:重复 handshake,忽略
		return nil
	}
	// 协议版本检查
	if err := checkVersion(m.ClientVersion); err != nil {
		_ = conn.Send("S2C_Error", &wildwoodv1.S2C_Error{
			Code:    wildwoodv1.RoomErrorCode_ROOM_ERROR_VERSION_MISMATCH,
			Message: err.Error(),
			Context: m.ClientVersion,
		})
		return err
	}
	pid, token := h.RegisterPlayer(m.PlayerName)
	conn.SetPlayerID(pid)

	// 把 conn 反查到 player(后续 dispatch 用)
	h.mu.Lock()
	if p, ok := h.players[pid]; ok {
		p.Conn = conn
	}
	h.mu.Unlock()

	return conn.Send("S2C_HandshakeAck", &wildwoodv1.S2C_HandshakeAck{
		ServerVersion:  "0.1.0",
		PlayerId:       pid,
		SessionToken:   token,
		ServerTickRate: uint32(h.tickHz),
		MaxRoomPlayers: MaxPlayersPerRoom,
	})
}

func (h *Hub) handleHeartbeat(conn *transport.Conn, m *wildwoodv1.C2S_Heartbeat) error {
	return conn.Send("S2C_HeartbeatAck", &wildwoodv1.S2C_HeartbeatAck{
		ClientTimeMs: m.ClientTimeMs,
		PingSeq:      m.PingSeq,
		ServerTimeMs: uint64(time.Now().UnixMilli()),
	})
}

func (h *Hub) handleRoomCreate(conn *transport.Conn, m *wildwoodv1.C2S_RoomCreate) error {
	playerID, ok := conn.GetPlayerID()
	if !ok {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_UNSPECIFIED, "handshake required", "")
	}
	max := int(m.MaxPlayers)
	if max <= 0 || max > MaxPlayersPerRoom {
		max = MaxPlayersPerRoom
	}
	rid := h.nextRoomID()
	token := h.nextToken()
	r := newRoom(rid, m.RoomName, token, m.WorldSeed)
	r.MaxPlayers = max

	h.mu.Lock()
	h.rooms[rid] = r
	p := h.players[playerID]
	h.mu.Unlock()

	if p != nil {
		p.RoomID = rid
		p.Conn = conn
		r.AddMember(p)
	}

	r.Broadcast(encodeFrame("S2C_RoomCreated", &wildwoodv1.S2C_RoomCreated{
		RoomId:     rid,
		JoinToken:  token,
		MaxPlayers: uint32(max),
	}))
	return nil
}

func (h *Hub) handleRoomJoin(conn *transport.Conn, m *wildwoodv1.C2S_RoomJoin) error {
	playerID, ok := conn.GetPlayerID()
	if !ok {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_UNSPECIFIED, "handshake required", "")
	}
	h.mu.RLock()
	r, exists := h.rooms[m.RoomId]
	p := h.players[playerID]
	h.mu.RUnlock()
	if !exists {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_NOT_FOUND, "room not found", m.RoomId)
	}
	if r.JoinToken != m.JoinToken {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_NOT_FOUND, "invalid join_token", m.RoomId)
	}
	if r.MemberCount() >= r.MaxPlayers {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_FULL,
			fmt.Sprintf("room is full (%d/%d)", r.MaxPlayers, r.MaxPlayers), m.RoomId)
	}
	if p == nil {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_UNSPECIFIED, "player not found", playerID)
	}

	p.RoomID = r.ID
	p.Conn = conn
	r.AddMember(p)
	members := r.Members()

	// 1) 给加入者:RoomJoined + world snapshot
	_ = conn.Send("S2C_RoomJoined", &wildwoodv1.S2C_RoomJoined{
		RoomId:   r.ID,
		PlayerId: p.ID,
		Members:  members,
		InitialState: &wildwoodv1.WorldSnapshot{
			ServerTick:   1,
			ServerTimeMs: uint64(time.Now().UnixMilli()),
			Players:      members,
			WorldSeed:    r.WorldSeed,
			Season:       "autumn",
			Day:          1,
		},
		ServerTick: 1,
	})

	// 1.5) M2.11 codex 全量同步(给加入者)— database + 当前 unlocked
	_ = conn.Send("S2C_CodexSync", BuildCodexSync(1, uint64(time.Now().UnixMilli())))

	// 2) 广播给其他成员:PlayerJoined + RoomStateChanged (M1.11 验收 ③ 房间状态变更对全队广播)
	joined := &wildwoodv1.S2C_PlayerJoined{
		RoomId: r.ID,
		Player: p.Snapshot(),
	}
	r.BroadcastExcept(encodeFrame("S2C_PlayerJoined", joined), p.ID)
	r.Broadcast(encodeFrame("S2C_RoomStateChanged", &wildwoodv1.S2C_RoomStateChanged{
		RoomId:         r.ID,
		CurrentPlayers: uint32(r.MemberCount()),
		MaxPlayers:     uint32(r.MaxPlayers),
		Trigger:        "join",
	}))
	return nil
}

func (h *Hub) handleRoomLeave(conn *transport.Conn, m *wildwoodv1.C2S_RoomLeave) error {
	playerID, ok := conn.GetPlayerID()
	if !ok {
		return nil
	}
	h.mu.RLock()
	p, pok := h.players[playerID]
	var r *Room
	if pok {
		r = h.rooms[p.RoomID]
	}
	h.mu.RUnlock()
	if !pok || r == nil {
		return nil
	}
	r.RemoveMember(playerID)
	p.RoomID = ""

	// 广播给剩下的成员
	r.Broadcast(encodeFrame("S2C_PlayerLeft", &wildwoodv1.S2C_PlayerLeft{
		RoomId:   r.ID,
		PlayerId: playerID,
		Reason:   "leave",
	}))
	r.Broadcast(encodeFrame("S2C_RoomStateChanged", &wildwoodv1.S2C_RoomStateChanged{
		RoomId:         r.ID,
		CurrentPlayers: uint32(r.MemberCount()),
		MaxPlayers:     uint32(r.MaxPlayers),
		Trigger:        "leave",
	}))

	// 房间空 → 清理
	if r.MemberCount() == 0 {
		h.mu.Lock()
		delete(h.rooms, r.ID)
		h.mu.Unlock()
	}

	// 给离开者回 ack
	_ = conn.Send("S2C_RoomLeft", &wildwoodv1.S2C_RoomLeft{
		RoomId: r.ID,
	})
	return nil
}

// handleRoomKick 房主踢人 (M1.11 验收 ②)
//
// 流程:
//  1. 调用方必须是 host(hostID 比对)
//  2. 目标必须在同房间
//  3. 目标收到 S2C_RoomKicked + ROOM_ERROR_KICKED(明确错误码)
//  4. 全队(包括被踢者以外的成员)收到 S2C_PlayerLeft(reason="kicked")
//  5. 全队收到 S2C_RoomStateChanged 槽位刷新
//  6. 槽位立即释放(MemberCount 减 1),下个 join 不再返回 ROOM_ERROR_FULL
//
// 错误码约定:
//   - ROOM_ERROR_NOT_FOUND      房间不存在
//   - ROOM_ERROR_INVALID_INPUT  非 host / 目标不在房间
func (h *Hub) handleRoomKick(conn *transport.Conn, m *wildwoodv1.C2S_RoomKick) error {
	hostID, ok := conn.GetPlayerID()
	if !ok {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_UNSPECIFIED, "handshake required", "")
	}
	if m.TargetPlayerId == "" {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "missing target_player_id", hostID)
	}
	if m.TargetPlayerId == hostID {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "cannot kick self", hostID)
	}
	if len(m.Reason) > 64 {
		m.Reason = m.Reason[:64]
	}
	if m.Reason == "" {
		m.Reason = "kicked_by_host"
	}

	h.mu.RLock()
	r, exists := h.rooms[m.RoomId]
	target, targetOK := h.players[m.TargetPlayerId]
	hostPlayer, hostOK := h.players[hostID]
	h.mu.RUnlock()
	if !exists {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_NOT_FOUND, "room not found", m.RoomId)
	}
	if !targetOK {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_NOT_FOUND, "target player not found", m.TargetPlayerId)
	}
	if !hostOK || hostPlayer.RoomID != r.ID {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "caller not in room", hostID)
	}
	if r.HostID() != hostID {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "only host can kick", hostID)
	}
	if target.RoomID != r.ID {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "target not in this room", m.TargetPlayerId)
	}

	// 1) 踢出 (持有写锁,避免并发 join 误判满员)
	h.mu.Lock()
	r.RemoveMember(target.ID)
	target.RoomID = ""
	roomEmpty := r.MemberCount() == 0
	if roomEmpty {
		delete(h.rooms, r.ID)
	}
	currentPlayers := uint32(r.MemberCount())
	maxPlayers := uint32(r.MaxPlayers)
	roomID := r.ID
	targetConn := target.Conn
	h.mu.Unlock()

	// 2) 通知被踢者:S2C_RoomKicked(直接给客户端)+ S2C_Error(明确错误码,符合"明确错误码"验收)
	if targetConn != nil {
		_ = targetConn.Send("S2C_RoomKicked", &wildwoodv1.S2C_RoomKicked{
			RoomId:        roomID,
			KickedById:    hostID,
			Reason:        m.Reason,
			ServerTimeMs:  uint64(time.Now().UnixMilli()),
		})
		_ = targetConn.Send("S2C_Error", &wildwoodv1.S2C_Error{
			Code:    wildwoodv1.RoomErrorCode_ROOM_ERROR_KICKED,
			Message: "kicked by host: " + m.Reason,
			Context: roomID,
		})
	}

	// 3) 通知全队(包括被踢者,作为冗余):PlayerLeft
	if !roomEmpty {
		r.Broadcast(encodeFrame("S2C_PlayerLeft", &wildwoodv1.S2C_PlayerLeft{
			RoomId:   roomID,
			PlayerId: target.ID,
			Reason:   "kicked",
		}))
	}

	// 4) 通知全队:RoomStateChanged(槽位刷新,触发 UI 重新计算剩余位)
	// 注意:host 也在 r.members 中(只要他没被踢),Broadcast 已覆盖;无需再单独 conn.Send
	if !roomEmpty {
		r.Broadcast(encodeFrame("S2C_RoomStateChanged", &wildwoodv1.S2C_RoomStateChanged{
			RoomId:         roomID,
			CurrentPlayers: currentPlayers,
			MaxPlayers:     maxPlayers,
			Trigger:        "kick",
		}))
	}

	// 5) 房主 ack:已在步骤 4 收到 RoomStateChanged,无需冗余发送
	//    (历史版本此处有 conn.Send 重复发,导致 host 收到 2 份 RoomStateChanged,
	//     污染后续 p5.rejoin 的广播断言 — 2026-08-20 修复)

	return nil
}

func (h *Hub) handleRoomList(conn *transport.Conn) error {
	h.mu.RLock()
	rooms := make([]*wildwoodv1.S2C_RoomState, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, &wildwoodv1.S2C_RoomState{
			RoomId:         r.ID,
			CurrentPlayers: uint32(r.MemberCount()),
			MaxPlayers:     uint32(r.MaxPlayers),
			IsOpen:         true,
		})
	}
	total := uint32(len(rooms))
	h.mu.RUnlock()
	return conn.Send("S2C_RoomList", &wildwoodv1.S2C_RoomList{
		Rooms: rooms,
		Total: total,
	})
}

func (h *Hub) handlePlayerInput(conn *transport.Conn, m *wildwoodv1.C2S_PlayerInput) error {
	playerID, ok := conn.GetPlayerID()
	if !ok {
		return nil
	}
	h.mu.RLock()
	p, pok := h.players[playerID]
	var r *Room
	if pok {
		r = h.rooms[p.RoomID]
	}
	h.mu.RUnlock()
	if !pok || r == nil {
		return nil
	}
	// 简单 echo:M2.1 接入移动/采集后替换
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:     1,
		ServerTimeMs:   uint64(time.Now().UnixMilli()),
		AckedInputSeqs: []uint32{m.InputSeq},
	}
	r.Broadcast(encodeFrame("S2C_WorldDelta", delta))
	return nil
}

func (h *Hub) handleChat(conn *transport.Conn, m *wildwoodv1.C2S_ChatMsg) error {
	playerID, ok := conn.GetPlayerID()
	if !ok {
		return nil
	}
	h.mu.RLock()
	p, pok := h.players[playerID]
	var r *Room
	if pok {
		r = h.rooms[p.RoomID]
	}
	h.mu.RUnlock()
	if !pok || r == nil {
		return nil
	}
	r.Broadcast(encodeFrame("S2C_ChatBroadcast", &wildwoodv1.S2C_ChatBroadcast{
		Channel:        m.Channel,
		SenderId:       p.ID,
		SenderName:     p.Name,
		TargetPlayerId: m.TargetPlayerId,
		Text:           m.Text,
		ServerTimeMs:   uint64(time.Now().UnixMilli()),
	}))
	return nil
}

// handleCodexQuery 处理客户端图鉴查询请求
//
//	kind=FULL:   返回全量 database(已在 join 时通过 S2C_CodexSync 一次性下发;
//	             本方法作为客户端断线重连后的补发入口)
//	kind=ENTRY:  返回单条 entry(供详情卡打开时按需取,正常情况已包含在 Sync 中)
//
//	简化版(M2.11): 命中 FULL 时复用 BuildCodexSync;命中 ENTRY 时按 entry_id 过滤
//	M2.14 美术资产 + M2.10 战斗系统接入后,可改为只下发 sprite_key 变更条目
func (h *Hub) handleCodexQuery(conn *transport.Conn, m *wildwoodv1.C2S_CodexQuery) error {
	if _, ok := conn.GetPlayerID(); !ok {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_UNSPECIFIED, "handshake required", "")
	}
	nowMs := uint64(time.Now().UnixMilli())
	switch m.Kind {
	case wildwoodv1.CodexQueryKind_CODEX_QUERY_KIND_FULL:
		return conn.Send("S2C_CodexSync", BuildCodexSync(0, nowMs))
	case wildwoodv1.CodexQueryKind_CODEX_QUERY_KIND_ENTRY:
		if m.EntryId == "" {
			return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "missing entry_id", "")
		}
		// 单条查询:复用 BuildCodexSync,客户端按 entry_id 过滤
		// 简化版 — 真正按需下发留 M2.14 美术优化阶段
		return conn.Send("S2C_CodexSync", BuildCodexSync(0, nowMs))
	default:
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "unknown query kind", "")
	}
}

// handleCodexView 客户端开关图鉴面板(目前仅记录,后续接 UI 状态同步)
func (h *Hub) handleCodexView(conn *transport.Conn, m *wildwoodv1.C2S_CodexView) error {
	if _, ok := conn.GetPlayerID(); !ok {
		return sendError(conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_UNSPECIFIED, "handshake required", "")
	}
	// 简化版:只校验 + 忽略(M2.11 无后端状态)
	_ = m
	return nil
}

// ===========================
// 工具 / 数据
// ===========================

func sendError(conn *transport.Conn, code wildwoodv1.RoomErrorCode, msg, ctx string) error {
	return conn.Send("S2C_Error", &wildwoodv1.S2C_Error{
		Code:    code,
		Message: msg,
		Context: ctx,
	})
}

func encodeFrame(typeName string, m proto.Message) transport.Frame {
	payload, err := proto.Marshal(m)
	if err != nil {
		return transport.Frame{Type: typeName, Payload: nil}
	}
	return transport.Frame{Type: typeName, Payload: payload}
}

func (h *Hub) nextPlayerID() string {
	return fmt.Sprintf("p-%d", h.playerSeq.Add(1))
}

func (h *Hub) nextRoomID() string {
	return fmt.Sprintf("r-%05d", h.roomSeq.Add(1))
}

func (h *Hub) nextToken() string {
	return fmt.Sprintf("t-%05d", h.tokenSeq.Add(1))
}

// Room 一间房间
type Room struct {
	ID         string
	Name       string
	JoinToken  string
	MaxPlayers int
	WorldSeed  string
	CreatedAt  time.Time

	mu      sync.RWMutex
	members map[string]*Player
	hostID  string

	// M2.11 codex state(per-room,队伍共享 5Hz 同步)
	codex *CodexState
}

func newRoom(id, name, token, seed string) *Room {
	return &Room{
		ID:         id,
		Name:       name,
		JoinToken:  token,
		MaxPlayers: MaxPlayersPerRoom,
		WorldSeed:  seed,
		CreatedAt:  time.Now(),
		members:    make(map[string]*Player),
		codex:      NewCodexState(),
	}
}

// NewRoomForTest 暴露给测试包使用(不依赖 Hub 即可构造房间)
func NewRoomForTest(id, name, token, seed string) *Room {
	return newRoom(id, name, token, seed)
}

// CodexState 返回 codex 状态(供测试 + Hub 钩子用)
func (r *Room) CodexState() *CodexState { return r.codex }

func (r *Room) Members() []*wildwoodv1.PlayerState {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*wildwoodv1.PlayerState, 0, len(r.members))
	for _, p := range r.members {
		out = append(out, p.Snapshot())
	}
	return out
}

func (r *Room) AddMember(p *Player) {
	r.mu.Lock()
	r.members[p.ID] = p
	if r.hostID == "" {
		r.hostID = p.ID
	}
	r.mu.Unlock()
}

func (r *Room) RemoveMember(playerID string) {
	r.mu.Lock()
	delete(r.members, playerID)
	if r.hostID == playerID {
		r.hostID = ""
	}
	r.mu.Unlock()
}

func (r *Room) MemberCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.members)
}

// HostID 返回房主 id(供测试/外部观察用)
func (r *Room) HostID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.hostID
}

func (r *Room) Broadcast(f transport.Frame) {
	r.mu.RLock()
	members := make([]*Player, 0, len(r.members))
	for _, p := range r.members {
		members = append(members, p)
	}
	r.mu.RUnlock()
	for _, p := range members {
		_ = p.Conn.SendFrame(f)
	}
}

func (r *Room) BroadcastExcept(f transport.Frame, exceptPlayerID string) {
	r.mu.RLock()
	members := make([]*Player, 0, len(r.members))
	for _, p := range r.members {
		if p.ID != exceptPlayerID {
			members = append(members, p)
		}
	}
	r.mu.RUnlock()
	for _, p := range members {
		_ = p.Conn.SendFrame(f)
	}
}

// Player 玩家
type Player struct {
	ID       string
	Name     string
	Conn     *transport.Conn
	RoomID   string
	JoinedAt time.Time
}

func (p *Player) Snapshot() *wildwoodv1.PlayerState {
	return &wildwoodv1.PlayerState{
		PlayerId:   p.ID,
		PlayerName: p.Name,
		Position:   &wildwoodv1.Vec2F{X: 0, Y: 0},
		Facing:     0,
		ColorRgb:   0xc89058,
		IsAlive:    true,
	}
}

func checkVersion(clientVersion string) error {
	if clientVersion == "" {
		return fmt.Errorf("empty client_version")
	}
	// 主版本 0 都接受(次版本兼容)
	if clientVersion[0] == '0' {
		return nil
	}
	return fmt.Errorf("client_version %q not compatible with server 0.1.x", clientVersion)
}

// 静默导入 codec 防止 vendor prune
var _ = codec.MaxFrameSize
