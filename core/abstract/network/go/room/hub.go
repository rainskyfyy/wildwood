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
// M2.1/M2.2 扩展:
//   - Hub 加 currentTick 记录 server tick
//   - Player 加 PosX / PosY / Facing(M2.1 移动)
//   - Room 加 World(M2.2 资源/采集状态)
//   - handlePlayerInput 路由到 MOVE/GATHER/ATTACK 子 handler
//   - tickLoop 调用 Room.TickGather + TickRespawn
//   - handleRoomCreate 自动 InitWorld(默认 12 资源)
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
	mu          sync.RWMutex
	rooms       map[string]*Room
	players     map[string]*Player
	playerSeq   atomic.Uint32 // 独立:玩家 id 自增 (p-NNN)
	roomSeq     atomic.Uint32 // 独立:房间 id 自增 (r-NNNNN) 5 位短链
	tokenSeq    atomic.Uint32 // 独立:join_token 自增 (t-NNNNN)
	currentTick uint32        // M2.1/M2.2 tick counter
	tickHz      int
	onTick      func(tick uint32, r *Room)
	stop        chan struct{}
	wg          sync.WaitGroup
}

// NewHub 构造房间中心
func NewHub(tickHz int) *Hub {
	if tickHz <= 0 {
		tickHz = 20
	}
	return &Hub{
		rooms:   make(map[string]*Room),
		players: make(map[string]*Player),
		tickHz:  tickHz,
		stop:    make(chan struct{}),
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

// Start 启动 20Hz tick 循环
func (h *Hub) Start() {
	h.wg.Add(1)
	go h.tickLoop()
}

// Stop 停止 tick 循环
func (h *Hub) Stop() {
	close(h.stop)
	h.wg.Wait()
}

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
			h.currentTick++
			h.mu.RLock()
			rooms := make([]*Room, 0, len(h.rooms))
			for _, r := range h.rooms {
				rooms = append(rooms, r)
			}
			h.mu.RUnlock()
			// M2.2:每个 tick 推进世界状态(采集倒计时 + respawn)
			for _, r := range rooms {
				h.tickRoom(r)
			}
			if h.onTick != nil {
				for _, r := range rooms {
					h.onTick(h.currentTick, r)
				}
			}
		}
	}
}

// tickRoom 单个房间一个 tick:采集 + respawn + 广播
//
// 设计:只在 *有变化时* 广播 S2C_WorldDelta(M1.11 baseline 行为)。
// 每个 tick 都广播全部资源会和 M1.11 kick 流程的帧断言冲突(测试期望
// S2C_PlayerLeft / S2C_RoomStateChanged 是独立帧,而不是夹在 WorldDelta 里)。
func (h *Hub) tickRoom(r *Room) {
	if r.World == nil {
		return
	}
	now := time.Now()
	updates, events := r.TickGather(now)
	respawnUpdates := r.TickRespawn(now)
	// 合并 changed resources(gather 推进 + respawn)
	allChanged := make([]ResourceState, 0, len(updates)+len(respawnUpdates))
	allChanged = append(allChanged, updates...)
	allChanged = append(allChanged, respawnUpdates...)
	if len(allChanged) == 0 && len(events) == 0 {
		return
	}
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:    h.currentTick,
		ServerTimeMs:  uint64(now.UnixMilli()),
		EntityUpdates: BuildWorldDeltaForResources(allChanged),
		Events:        events,
	}
	r.Broadcast(encodeFrame("S2C_WorldDelta", delta))
}

// RegisterPlayer 玩家首次握手时注册,返回 player_id + session_token
func (h *Hub) RegisterPlayer(playerName string) (string, string) {
	pid := h.nextPlayerID()
	p := &Player{
		ID:       pid,
		Name:     playerName,
		JoinedAt: time.Now(),
		PosX:     200 + float32(len(h.players))*40, // 错开初始位置
		PosY:     200,
		Facing:   0,
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

	// M2.2:把 World resources 注入 WorldSnapshot
	resources := r.ListWorldResources()

	// 1) 给加入者:RoomJoined + world snapshot
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

// handlePlayerInput 路由到 MOVE / GATHER / ATTACK 子 handler (M2.1 + M2.2)
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
	switch m.Action {
	case wildwoodv1.InputAction_INPUT_ACTION_MOVE:
		return h.HandlePlayerInputMove(p, r, m)
	case wildwoodv1.InputAction_INPUT_ACTION_GATHER:
		return h.HandlePlayerInputGather(p, r, m)
	case wildwoodv1.InputAction_INPUT_ACTION_ATTACK:
		return h.HandlePlayerInputAttack(p, r, m)
	default:
		// 其他 action(M2.x BUILD/USE_ITEM/INTERACT)留待对应任务
		// 仍回 ack,让客户端 input_seq 不被卡
		delta := &wildwoodv1.S2C_WorldDelta{
			ServerTick:     h.currentTick,
			ServerTimeMs:   uint64(time.Now().UnixMilli()),
			AckedInputSeqs: []uint32{m.InputSeq},
		}
		r.Broadcast(encodeFrame("S2C_WorldDelta", delta))
		return nil
	}
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
	World   *World // M2.2 房间世界状态(资源/采集);可空
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
	}
}

// ListWorldResources 把 World resources 转 protobuf EntityState
func (r *Room) ListWorldResources() []*wildwoodv1.EntityState {
	if r.World == nil {
		return nil
	}
	return BuildWorldDeltaForResources(r.World.ListResources())
}

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
	// M2.1:位置 + 朝向
	PosX   float32
	PosY   float32
	Facing float32
}

// Position 返回玩家位置(供 GATHER reach 判定)
func (p *Player) Position() wildwoodv1.Vec2F {
	return wildwoodv1.Vec2F{X: p.PosX, Y: p.PosY}
}

func (p *Player) Snapshot() *wildwoodv1.PlayerState {
	return &wildwoodv1.PlayerState{
		PlayerId:   p.ID,
		PlayerName: p.Name,
		Position:   &wildwoodv1.Vec2F{X: p.PosX, Y: p.PosY},
		Facing:     p.Facing,
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
