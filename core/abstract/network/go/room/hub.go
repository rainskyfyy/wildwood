// Package room: 真实房间服务 — 复用 M1.5 协议语义,支持多连接 + 4 人硬约束 + 20Hz tick 钩子。
//
// 关键约束(来自项目方案 §5.4):
//   - 4 人小队上限(1 主机 + 3 队友):第 5 人加入返回 ROOM_ERROR_FULL
//   - 20Hz tick:tickLoop 每 50ms 调用一次,推进玩家移动 + 资源采集 + respawn(M2.1/M2.2)
//   - 5 分钟断线保留:玩家断线后保留 slot 5 分钟,超时生成"离线墓碑"
//
// 业务逻辑继承自 mocks.MockServer(M1.5 已对齐协议层互通),
// 区别:mocks 是单连接;room.Hub 支持 N 个连接跨房间广播。
//
// M3.1 扩展:Hub 集成权威状态(AuthState)+ 20Hz tick 广播 WorldDelta
//   - handlePlayerInput: 应用输入到 AuthState,记录 last_acked_seq
//   - tickLoop: 每 tick 广播 S2C_WorldDelta{acked_input_seqs, entity_updates}
package room

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"strings"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	"github.com/wildwood/net/transport"
)

// MaxPlayersPerRoom 硬约束(方案 §5.4)
const MaxPlayersPerRoom = 4

// AuthStateStartingPos 玩家初始位置(像素);M3.1 占位,M2.1 已用真实 spawn 点
const AuthStateStartingPos = 100.0

// Hub 房间注册表 + 玩家注册表
type Hub struct {
	mu        sync.RWMutex
	rooms     map[string]*Room
	players   map[string]*Player
	playerSeq atomic.Uint32
	roomSeq   atomic.Uint32
	tokenSeq  atomic.Uint32
	tickHz    int
	tickCount atomic.Uint64 // M3.1: 自增 tick 计数器
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

// initHubDeath 惰性初始化死亡子系统(供 hub_test / M2.5 测试在 Start 之前调)
func (h *Hub) initHubDeath() {
	if h.ds == nil {
		h.ds = NewDeathSubSystem(h)
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

// CurrentTick 当前 server tick
func (h *Hub) CurrentTick() uint32 { return h.currentTick }

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

// TickCount 返回自 Hub.Start 以来的 tick 计数(测试用,用于压测统计)
func (h *Hub) TickCount() uint64 { return h.tickCount.Load() }

// Start 启动 20Hz tick 循环
func (h *Hub) Start() {
	h.initHubDeath()
	h.startedAt = time.Now()
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
	for {
		select {
		case <-h.stop:
			return
		case <-t.C:
			tick++
			h.tickCount.Add(1)
			h.mu.RLock()
			rooms := make([]*Room, 0, len(h.rooms))
			for _, r := range h.rooms {
				rooms = append(rooms, r)
			}
			h.mu.RUnlock()

			// M3.1: 每 tick 给每个非空房间广播 WorldDelta
			for _, r := range rooms {
				if r.MemberCount() == 0 {
					continue
				}
				h.broadcastWorldDelta(tick, r)
			}

			if h.onTick != nil {
				for _, r := range rooms {
					h.onTick(tick, r)
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

// broadcastWorldDelta 构造并广播 S2C_WorldDelta(M3.1 关键)
//
// 包含:
//   - acked_input_seqs: 该房间所有玩家的 last_input_seq
//   - entity_updates:  所有玩家的 EntityState(权威位置/朝向/HP)
func (h *Hub) broadcastWorldDelta(tick uint32, r *Room) {
	r.mu.RLock()
	members := make([]*Player, 0, len(r.members))
	for _, p := range r.members {
		members = append(members, p)
	}
	r.mu.RUnlock()

	if len(members) == 0 {
		return
	}

	ackedSeqs := make([]uint32, 0, len(members))
	entities := make([]*wildwoodv1.EntityState, 0, len(members))
	for _, p := range members {
		auth := p.AuthState()
		if auth == nil {
			continue
		}
		seq := auth.LastInputSeq()
		if seq > 0 {
			ackedSeqs = append(ackedSeqs, seq)
		}
		x, y := auth.Pos()
		facing := auth.Facing()
		entities = append(entities, &wildwoodv1.EntityState{
			EntityId: entityIDFromPlayer(p.ID),
			Kind:     wildwoodv1.EntityKind_ENTITY_KIND_PLAYER,
			Position: &wildwoodv1.Vec2F{X: float32(x), Y: float32(y)},
			Facing:   float32(facing),
			Hp:       100,
			MaxHp:    100,
			PrefabId: 0,
			PlayerId: p.ID,
		})
	}

	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:     tick,
		ServerTimeMs:   uint64(time.Now().UnixMilli()),
		AckedInputSeqs: ackedSeqs,
		EntityUpdates:  entities,
	}
	r.Broadcast(encodeFrame("S2C_WorldDelta", delta))
}

// entityIDFromPlayer 简单 hash:用 player id 字符串前 8 字符当 entity id(房间内稳定)
func entityIDFromPlayer(playerID string) uint32 {
	var h uint32 = 2166136261
	for i := 0; i < len(playerID) && i < 8; i++ {
		h ^= uint32(playerID[i])
		h *= 16777619
	}
	return h
}

// RegisterPlayer 玩家首次握手时注册,返回 player_id + session_token
func (h *Hub) RegisterPlayer(playerName string) (string, string) {
	pid := h.nextPlayerID()
	p := &Player{
		ID:       pid,
		Name:     playerName,
		JoinedAt: time.Now(),
		auth:     NewAuthState(AuthStateStartingPos, AuthStateStartingPos, AuthStateDefaultSpeedMps),
	}
	h.mu.Lock()
	h.players[pid] = p
	h.mu.Unlock()
	return pid, fmt.Sprintf("sess-%s", pid)
}

// Handle 把 C2S 消息分发到对应的 handler
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
	if _, ok := conn.GetPlayerID(); ok {
		return nil
	}
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
	// M2.2:初始化世界状态 + 默认 12 资源
	r.InitWorld()

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

	_ = conn.Send("S2C_RoomJoined", &wildwoodv1.S2C_RoomJoined{
		RoomId:   r.ID,
		PlayerId: p.ID,
		Members:  members,
		InitialState: &wildwoodv1.WorldSnapshot{
			ServerTick:    h.currentTick,
			ServerTimeMs:  uint64(time.Now().UnixMilli()),
			Players:       members,
			Entities:      resources,
			WorldSeed:     r.WorldSeed,
			Season:        "autumn",
			Day:           1,
		},
		ServerTick: h.currentTick,
	})

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

	if r.MemberCount() == 0 {
		h.mu.Lock()
		delete(h.rooms, r.ID)
		h.mu.Unlock()
	}

	_ = conn.Send("S2C_RoomLeft", &wildwoodv1.S2C_RoomLeft{
		RoomId: r.ID,
	})
	return nil
}

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

	if targetConn != nil {
		_ = targetConn.Send("S2C_RoomKicked", &wildwoodv1.S2C_RoomKicked{
			RoomId:       roomID,
			KickedById:   hostID,
			Reason:       m.Reason,
			ServerTimeMs: uint64(time.Now().UnixMilli()),
		})
		_ = targetConn.Send("S2C_Error", &wildwoodv1.S2C_Error{
			Code:    wildwoodv1.RoomErrorCode_ROOM_ERROR_KICKED,
			Message: "kicked by host: " + m.Reason,
			Context: roomID,
		})
	}

	if !roomEmpty {
		r.Broadcast(encodeFrame("S2C_PlayerLeft", &wildwoodv1.S2C_PlayerLeft{
			RoomId:   roomID,
			PlayerId: target.ID,
			Reason:   "kicked",
		}))
	}
	if !roomEmpty {
		r.Broadcast(encodeFrame("S2C_RoomStateChanged", &wildwoodv1.S2C_RoomStateChanged{
			RoomId:         roomID,
			CurrentPlayers: currentPlayers,
			MaxPlayers:     maxPlayers,
			Trigger:        "kick",
		}))
	}

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
		})
	}
	h.mu.RUnlock()
	return conn.Send("S2C_RoomList", &wildwoodv1.S2C_RoomList{Rooms: rooms})
}

// handlePlayerInput 路由到 MOVE / GATHER / ATTACK 子 handler (M2.1 + M2.2)
func (h *Hub) handlePlayerInput(conn *transport.Conn, m *wildwoodv1.C2S_PlayerInput) error {
	playerID, ok := conn.GetPlayerID()
	if !ok {
		return nil
	}
	h.mu.RLock()
	p, pok := h.players[playerID]
	h.mu.RUnlock()
	if !pok {
		return nil
	}
	// M3.1: 应用输入到 AuthState(权威状态机)
	auth := p.AuthState()
	if auth == nil {
		return nil
	}
	accepted, _ := auth.ApplyInput(m)
	_ = accepted // 拒绝时由下一个 tick 自然反映(不广播单独帧,延迟也低)
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

// currentTick 返回当前 server tick(M2.3 新增,给 WorldDelta.server_tick 用)。
func (h *Hub) currentTick() uint32 {
	return h.tickCount.Load()
}

// nextEventID 分配下一个 WorldEvent.event_id(M2.3 新增,单调递增,客户端可对账)。
func (h *Hub) nextEventID() uint32 {
	return h.eventSeq.Add(1)
}

// roomByID 通过 room_id 查找 Room(M2.3 新增,build.go 查房间用;并发安全)
func (h *Hub) roomByID(roomID string) *Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.rooms[roomID]
}

// BroadcastDelta 把任意 S2C proto message 编码并广播到房间(M2.3 新增,供 build.go 等子系统用)
//
// 容错:房间里的 Player 若 conn==nil(单测常见),跳过该玩家
//      真实环境 RegisterPlayer + handleRoomJoin 一定注入 conn
func (h *Hub) BroadcastDelta(r *Room, m proto.Message) error {
	if r == nil {
		return nil
	}
	frame := encodeFrame(protoMessageName(m), m)
	r.Broadcast(frame)
	return nil
}

// protoMessageName 取 proto message 的类型名(去掉包前缀),对齐 codec registry
func protoMessageName(m proto.Message) string {
	full := string(m.ProtoReflect().Descriptor().FullName())
	// "wildwood.net.v1.S2C_WorldDelta" → "S2C_WorldDelta"
	if idx := strings.LastIndex(full, "."); idx >= 0 {
		return full[idx+1:]
	}
	return full
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

// Broadcast 群发(给房间内所有成员)
func (r *Room) Broadcast(frame transport.Frame) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, p := range r.members {
		if p.Conn != nil {
			_ = p.Conn.SendFrame(frame)
		}
	}
}

// BroadcastExcept 群发排除某 player
func (r *Room) BroadcastExcept(frame transport.Frame, exceptID string) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, p := range r.members {
		if p.ID == exceptID {
			continue
		}
		if p.Conn != nil {
			_ = p.Conn.SendFrame(frame)
		}
	}
}

// Player 玩家
type Player struct {
	ID       string
	Name     string
	Conn     *transport.Conn
	RoomID   string
	JoinedAt time.Time
	auth     *AuthState // M3.1 权威状态
}

// AuthState 返回权威状态机(只读访问;并发由 AuthState 内部 mu 保护)
func (p *Player) AuthState() *AuthState { return p.auth }

func (p *Player) Snapshot() *wildwoodv1.PlayerState {
	// 优先用 AuthState 当前位置(若已存在)
	var pos *wildwoodv1.Vec2F
	var facing float32
	if p.auth != nil {
		x, y := p.auth.Pos()
		facing = float32(p.auth.Facing())
		pos = &wildwoodv1.Vec2F{X: float32(x), Y: float32(y)}
	} else {
		pos = &wildwoodv1.Vec2F{X: 0, Y: 0}
	}
	return &wildwoodv1.PlayerState{
		PlayerId:   p.ID,
		PlayerName: p.Name,
		Position:   pos,
		Facing:     facing,
		ColorRgb:   0xc89058,
		IsAlive:    true,
	}
}

func checkVersion(clientVersion string) error {
	if clientVersion == "" {
		return fmt.Errorf("empty client_version")
	}
	if clientVersion[0] == '0' {
		return nil
	}
	return fmt.Errorf("client_version %q not compatible with server 0.1.x", clientVersion)
}

// 静默导入 codec / strings 防止 vendor prune
var _ = codec.MaxFrameSize

// -------------------- M2.5 死亡与复活 helper --------------------

// BroadcastDelta 把任意 S2C proto message 编码并广播到房间(供 death.go 等子系统用)
//
// 容错:房间里的 Player 若 conn==nil(M2.5 单测常见,因不走真实 WS),跳过该玩家
//      真实环境 RegisterPlayer + handleRoomJoin 一定注入 conn
func (h *Hub) BroadcastDelta(r *Room, m proto.Message) error {
	if r == nil {
		return nil
	}
	frame := encodeFrame(protoMessageName(m), m)
	r.Broadcast(frame)
	return nil
}

// protoMessageName 取 proto message 的类型名(去掉包前缀),对齐 codec registry
func protoMessageName(m proto.Message) string {
	full := string(m.ProtoReflect().Descriptor().FullName())
	// "wildwood.net.v1.S2C_WorldDelta" → "S2C_WorldDelta"
	if idx := strings.LastIndex(full, "."); idx >= 0 {
		return full[idx+1:]
	}
	return full
}

// 静默导入 strings 防止 vendor prune
var _ = strings.LastIndex

// -------------------- M2.5 tick / event id 工具 --------------------

// currentTick 返回累计 tick(从 Start() 之后 0 开始累加)
func (h *Hub) currentTick() uint32 {
	return h.tickCount.Load()
}

// nextEventID 分配下一个事件 id
func (h *Hub) nextEventID() uint32 {
	return h.eventSeq.Add(1)
}
