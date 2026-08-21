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
	mu       sync.RWMutex
	rooms    map[string]*Room
	players  map[string]*Player
	roomSeq  atomic.Uint32
	tokenSeq atomic.Uint32
	tickHz   int
	onTick   func(tick uint32, r *Room)
	stop     chan struct{}
	wg       sync.WaitGroup
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

	// 2) 广播给其他成员:PlayerJoined
	joined := &wildwoodv1.S2C_PlayerJoined{
		RoomId: r.ID,
		Player: p.Snapshot(),
	}
	r.BroadcastExcept(encodeFrame("S2C_PlayerJoined", joined), p.ID)
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
	return fmt.Sprintf("p-%d", h.roomSeq.Add(1))
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
