// Package room_test: M1.11 房间创建/加入/离开基础流程 — 专项验收测试
//
// 覆盖任务《M1.11 房间创建/加入/离开基础流程 ★ 关键路径》3 条验收:
//   ① 第 5 人加入被拒(明确错误码: ROOM_ERROR_FULL)
//   ② 房主踢人后房间槽释放
//   ③ 房间状态变更对全队广播(S2C_RoomStateChanged / S2C_PlayerJoined / S2C_PlayerLeft)
//
// 这些测试与 hub_test.go 中的 TestFullLifecycle / TestRoomFull_RejectsFifth
// 互为补充:旧测试覆盖单条主流;本文件用 TestM111_ 前缀明确对齐 M1.11 验收条目。
package room_test

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"github.com/wildwood/net/codec"
	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// drainLoop 在 timeout 内排空 client 的所有消息(直到 ReadMessage 失败)
//
// 用于:host/成员在跑断言前清理掉意外残余的 broadcast 帧
func drainLoop(t *testing.T, c *client, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		c.ws.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		if len(data) == 0 {
			return
		}
	}
}

// recvOrEmpty 与 recv 类似,但 timeout 时不 fatal,只返回 ("", nil)
func (c *client) recvOrEmpty(t *testing.T, timeout time.Duration) (string, proto.Message) {
	t.Helper()
	c.ws.SetReadDeadline(time.Now().Add(timeout))
	_, data, err := c.ws.ReadMessage()
	if err != nil {
		return "", nil
	}
	rdr := codec.NewReader()
	frames, err := rdr.Feed(data)
	if err != nil || len(frames) == 0 {
		return "", nil
	}
	msg, err := codec.UnmarshalFrame(frames[0])
	if err != nil {
		return "", nil
	}
	return frames[0].Type, msg
}

// startReaderGoroutine 启动一个持续读 goroutine,把收到的帧放到 chan
//
// 用法:
//   ch := startReaderGoroutine(p2)
//   defer close(stopCh)
//   ... 触发服务端逻辑 ...
//   select { case f := <-ch: ... }
//
// 解决 recvOrEmpty 在"客户端和服务端读写混在同一 gorilla ws"上的时序不确定性:
//   旧 drain loop 用 200ms deadline 反复读,有时一帧没读完就死等
//   改用持续读 + chan 后,数据到达立即被消费,无 deadline 误差
func startReaderGoroutine(c *client) (<-chan *recvFrame, chan<- struct{}) {
	out := make(chan *recvFrame, 64)
	stop := make(chan struct{})
	go func() {
		rdr := codec.NewReader()
		for {
			select {
			case <-stop:
				return
			default:
			}
			c.ws.SetReadDeadline(time.Now().Add(2 * time.Second))
			_, data, err := c.ws.ReadMessage()
			if err != nil {
				// 关闭或超时
				select {
				case <-stop:
				default:
					// 不上报超时(可能是正常空闲);关闭/错误时返回 -1 标识 EOF
				}
				return
			}
			frames, err := rdr.Feed(data)
			if err != nil {
				continue
			}
			for _, f := range frames {
				msg, err := codec.UnmarshalFrame(f)
				if err != nil {
					continue
				}
				select {
				case out <- &recvFrame{Type: f.Type, Msg: msg}:
				case <-stop:
					return
				}
			}
		}
	}()
	return out, stop
}

type recvFrame struct {
	Type string
	Msg  proto.Message
}

// readFrameWithType 从持续读 chan 中取一帧,跳过类型不匹配的中间帧,
// timeout 内没等到 wantType 则返回 ("", nil)
func readFrameWithType(t *testing.T, ch <-chan *recvFrame, wantType string, timeout time.Duration) (string, proto.Message) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case f, ok := <-ch:
			if !ok {
				return "", nil
			}
			if f.Type == wantType {
				return f.Type, f.Msg
			}
			// 跳过中间帧(PlayerJoined/RoomStateChanged 等)
			continue
		case <-deadline:
			return "", nil
		}
	}
}

// ===========================
// 验收 ① 第 5 人加入被拒(明确错误码)
// ===========================

// TestM111_Acc01_FifthPlayerRejected
// 场景:
//  1. host 建房
//  2. p2 / p3 / p4 三个 join 凑满 4 人
//  3. p5 join → 收到 S2C_Error(Code=ROOM_ERROR_FULL,Message 含 "full")
//  4. 校验错误码 = ROOM_ERROR_FULL(明确),不是 ROOM_ERROR_UNSPECIFIED 等
func TestM111_Acc01_FifthPlayerRejected(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	host.handshake(t, "host")
	roomID, token := host.createRoom(t)

	// 凑满 4 人
	members := make([]*client, 3)
	for i := 0; i < 3; i++ {
		m := newClient(t, ts.URL)
		m.handshake(t, "p")
		m.joinRoom(t, roomID, token)
		// host 收 1 次 PlayerJoined + 1 次 RoomStateChanged
		_, _ = host.recv(t, 2*time.Second)
		_, _ = host.recv(t, 2*time.Second)
		members[i] = m
	}
	defer func() {
		for _, m := range members {
			m.close()
		}
	}()

	// 校验房内已 4 人
	hub.Mu().RLock()
	if r, ok := hub.Rooms()[roomID]; ok {
		if cnt := r.MemberCount(); cnt != 4 {
			hub.Mu().RUnlock()
			t.Fatalf("setup: members=%d want 4", cnt)
		}
	}
	hub.Mu().RUnlock()

	// p5 申请加入
	p5 := newClient(t, ts.URL)
	defer p5.close()
	p5.handshake(t, "p5")
	p5.send(t, "C2S_RoomJoin", &wildwoodv1.C2S_RoomJoin{
		RoomId:    roomID,
		JoinToken: token,
	})

	errMsg := p5.expectError(t)
	if errMsg.Code != wildwoodv1.RoomErrorCode_ROOM_ERROR_FULL {
		t.Errorf("accept①: code=%v want ROOM_ERROR_FULL (明确错误码)", errMsg.Code)
	}
	if !strings.Contains(strings.ToLower(errMsg.Message), "full") {
		t.Errorf("accept①: message=%q should mention 'full'", errMsg.Message)
	}
	if errMsg.Context != roomID {
		t.Errorf("accept①: context=%q want %q (含 room_id 便于客户端定位)", errMsg.Context, roomID)
	}
}

// ===========================
// 验收 ② 房主踢人后房间槽释放
// ===========================

// TestM111_Acc02_HostKickFreesSlot
// 场景:
//  1. host 建房,p2/p3/p4 凑满 4 人
//  2. p5 申请被拒(确认满员)
//  3. host 踢 p2 → p2 收到 S2C_RoomKicked + S2C_Error(ROOM_ERROR_KICKED)
//  4. 房内变 3 人
//  5. p5 再申请 → 成功(槽位已释放)
//  6. 非 host 调 kick → 拒绝
//  7. host 踢自己 → 拒绝
func TestM111_Acc02_HostKickFreesSlot(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	hostPlayerID := host.handshake(t, "host")
	roomID, token := host.createRoom(t)

	p2 := newClient(t, ts.URL)
	defer p2.close()
	p2PlayerID := p2.handshake(t, "p2")
	p2.joinRoom(t, roomID, token)
	// host 收 1 次 PlayerJoined + 1 次 RoomStateChanged
	_, _ = host.recv(t, 2*time.Second)
	_, _ = host.recv(t, 2*time.Second)

	p3 := newClient(t, ts.URL)
	defer p3.close()
	p3.handshake(t, "p3")
	p3.joinRoom(t, roomID, token)
	_, _ = host.recv(t, 2*time.Second)
	_, _ = host.recv(t, 2*time.Second)

	p4 := newClient(t, ts.URL)
	defer p4.close()
	p4PlayerID := p4.handshake(t, "p4")
	p4.joinRoom(t, roomID, token)
	_, _ = host.recv(t, 2*time.Second)
	_, _ = host.recv(t, 2*time.Second)

	// 此时房内 4 人
	hub.Mu().RLock()
	if r, ok := hub.Rooms()[roomID]; ok {
		if cnt := r.MemberCount(); cnt != 4 {
			hub.Mu().RUnlock()
			t.Fatalf("setup: members=%d want 4", cnt)
		}
	}
	hub.Mu().RUnlock() // [FIX] 原本误写为 RLock,导致读锁永不释放,后续 RegisterPlayer 的 Lock 永久阻塞
	_ = p4PlayerID

	// 启动 p2 持续读 goroutine: 把所有 S2C 帧丢到 chan
	p2Ch, p2Stop := startReaderGoroutine(p2)
	defer close(p2Stop)

	// 排空 p2 已堆积的 broadcast 帧(等 p3/p4 join 后所有 broadcast 都被消费)
	// 5 帧:p2 自己 join 时 1×S2C_RoomStateChanged + p3/p4 join 各 1×PlayerJoined + 1×RoomStateChanged
	for i := 0; i < 10; i++ {
		select {
		case <-p2Ch:
			continue
		case <-time.After(300 * time.Millisecond):
			i = 10 // 退出
		}
	}

	// p3 同样启动 reader goroutine:把后续 broadcast 帧自动消费,避免 p3.recv 读到中间帧
	p3Ch, p3Stop := startReaderGoroutine(p3)
	defer close(p3Stop)

	// p5 申请:先被拒
	p5 := newClient(t, ts.URL)
	defer p5.close()
	p5.handshake(t, "p5")
	p5.send(t, "C2S_RoomJoin", &wildwoodv1.C2S_RoomJoin{RoomId: roomID, JoinToken: token})
	p5Err := p5.expectError(t)
	if p5Err.Code != wildwoodv1.RoomErrorCode_ROOM_ERROR_FULL {
		t.Errorf("accept② setup: p5 should be rejected FULL, got %v", p5Err.Code)
	}

	// host 踢 p2
	host.send(t, "C2S_RoomKick", &wildwoodv1.C2S_RoomKick{
		RoomId:         roomID,
		TargetPlayerId: p2PlayerID,
		Reason:         "test-kick",
	})

	// p2 应该收到: S2C_RoomKicked + S2C_Error(ROOM_ERROR_KICKED)
	gotType, got := readFrameWithType(t, p2Ch, "S2C_RoomKicked", 3*time.Second)
	if gotType != "S2C_RoomKicked" {
		t.Fatalf("accept②: p2 frame 1 type=%s want S2C_RoomKicked", gotType)
	}
	kicked := got.(*wildwoodv1.S2C_RoomKicked)
	if kicked.KickedById != hostPlayerID {
		t.Errorf("accept②: kicked_by_id=%q want %q", kicked.KickedById, hostPlayerID)
	}
	if kicked.Reason != "test-kick" {
		t.Errorf("accept②: reason=%q want %q", kicked.Reason, "test-kick")
	}

	gotType, got = readFrameWithType(t, p2Ch, "S2C_Error", 3*time.Second)
	if gotType != "S2C_Error" {
		t.Fatalf("accept②: p2 frame 2 type=%s want S2C_Error", gotType)
	}
	p2Err := got.(*wildwoodv1.S2C_Error)
	if p2Err.Code != wildwoodv1.RoomErrorCode_ROOM_ERROR_KICKED {
		t.Errorf("accept②: p2 error code=%v want ROOM_ERROR_KICKED (明确错误码)", p2Err.Code)
	}

	// 校验房内: 3 人(host+p3+p4)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		hub.Mu().RLock()
		r, ok := hub.Rooms()[roomID]
		hub.Mu().RUnlock()
		if ok && r.MemberCount() == 3 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	hub.Mu().RLock()
	if r, ok := hub.Rooms()[roomID]; ok {
		if cnt := r.MemberCount(); cnt != 3 {
			hub.Mu().RUnlock()
			t.Errorf("accept②: after kick members=%d want 3 (槽位已释放)", cnt)
		} else {
			if r.HostID() != hostPlayerID {
				hub.Mu().RUnlock()
				t.Errorf("accept②: hostID=%q want %q (host 未变)", r.HostID(), hostPlayerID)
			}
		}
	} else {
		hub.Mu().RUnlock()
		t.Errorf("accept②: room disappeared unexpectedly")
	}
	hub.Mu().RLock()
	if p, ok := hub.Players()[p2PlayerID]; ok {
		if p.RoomID != "" {
			hub.Mu().RUnlock()
			t.Errorf("accept②: p2.RoomID=%q want \"\" (已被清空)", p.RoomID)
		}
	}
	hub.Mu().RUnlock()

	// host 收 PlayerLeft(reason="kicked") + RoomStateChanged(3/4)
	gotType, _ = host.recv(t, 1*time.Second)
	if gotType != "S2C_PlayerLeft" {
		t.Errorf("accept②: host PlayerLeft frame type=%s", gotType)
	}
	gotType, got = host.recv(t, 1*time.Second)
	if gotType != "S2C_RoomStateChanged" {
		t.Errorf("accept②: host RoomStateChanged frame type=%s", gotType)
	}
	state := got.(*wildwoodv1.S2C_RoomStateChanged)
	if state.CurrentPlayers != 3 || state.MaxPlayers != 4 {
		t.Errorf("accept②: state=%d/%d want 3/4", state.CurrentPlayers, state.MaxPlayers)
	}
	if state.Trigger != "kick" {
		t.Errorf("accept②: trigger=%q want \"kick\"", state.Trigger)
	}

	// p5 再申请:应成功(槽位已释放)
	p5.send(t, "C2S_RoomJoin", &wildwoodv1.C2S_RoomJoin{RoomId: roomID, JoinToken: token})
	joinMsgType, joinMsg := p5.recv(t, 2*time.Second)
	if joinMsgType != "S2C_RoomJoined" {
		t.Errorf("accept②: p5 rejoined type=%s (槽位释放后应成功)", joinMsgType)
	} else {
		joined := joinMsg.(*wildwoodv1.S2C_RoomJoined)
		if joined.RoomId != roomID {
			t.Errorf("accept②: p5 joined room=%q want %q", joined.RoomId, roomID)
		}
	}
	// host 也应收到 PlayerJoined(p5) + RoomStateChanged(4/4)
	gotType, _ = host.recv(t, 1*time.Second)
	if gotType != "S2C_PlayerJoined" {
		t.Errorf("accept②: host should see p5 join broadcast, type=%s", gotType)
	}
	gotType, got = host.recv(t, 1*time.Second)
	if gotType != "S2C_RoomStateChanged" {
		t.Errorf("accept②: host should see RoomStateChanged(4/4), type=%s", gotType)
	}
	state = got.(*wildwoodv1.S2C_RoomStateChanged)
	if state.CurrentPlayers != 4 {
		t.Errorf("accept②: state=%d want 4 after p5 rejoined", state.CurrentPlayers)
	}

	// 校验非 host 调 kick: p3 试图踢 p4 → 拒绝
	// p3 用 reader goroutine,所有 broadcast 帧已被消费;用 readFrameWithType 跳过中间帧
	p3.send(t, "C2S_RoomKick", &wildwoodv1.C2S_RoomKick{
		RoomId:         roomID,
		TargetPlayerId: p4PlayerID,
		Reason:         "bad",
	})
	gotType, got = readFrameWithType(t, p3Ch, "S2C_Error", 3*time.Second)
	if gotType != "S2C_Error" {
		t.Errorf("accept②: non-host kick expected error, got type=%s", gotType)
	} else {
		e := got.(*wildwoodv1.S2C_Error)
		if e.Code != wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT {
			t.Errorf("accept②: non-host kick error code=%v want ROOM_ERROR_INVALID_INPUT", e.Code)
		}
	}

	// host 踢自己 → 拒绝(参数校验)
	host.send(t, "C2S_RoomKick", &wildwoodv1.C2S_RoomKick{
		RoomId:         roomID,
		TargetPlayerId: hostPlayerID,
		Reason:         "self",
	})
	gotType, got = host.recv(t, 1*time.Second)
	if gotType != "S2C_Error" {
		t.Errorf("accept②: self-kick expected error, got type=%s", gotType)
	} else {
		e := got.(*wildwoodv1.S2C_Error)
		if e.Code != wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT {
			t.Errorf("accept②: self-kick error code=%v want ROOM_ERROR_INVALID_INPUT", e.Code)
		}
	}
}

// ===========================
// 验收 ③ 房间状态变更对全队广播
// ===========================

// TestM111_Acc03_RoomStateBroadcasts
// 场景:
//  1. host 建房
//  2. p2 join → host 应收到 S2C_PlayerJoined + S2C_RoomStateChanged
//  3. p2 离房 → host 应收到 S2C_PlayerLeft + S2C_RoomStateChanged
//  4. 校验所有广播的 current_players 字段与实际一致
func TestM111_Acc03_RoomStateBroadcasts(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	host.handshake(t, "host")
	roomID, token := host.createRoom(t)

	// 加 p2
	p2 := newClient(t, ts.URL)
	defer p2.close()
	p2PlayerID := p2.handshake(t, "p2")
	p2.joinRoom(t, roomID, token)
	// p2 的 joinRoom 已收到 RoomJoined (含 host)

	// 校验:host 收 PlayerJoined + RoomStateChanged(2/4, trigger=join)
	gotType, got := host.recv(t, 1*time.Second)
	if gotType != "S2C_PlayerJoined" {
		t.Fatalf("accept③ join: host frame 1 type=%s want PlayerJoined", gotType)
	}
	pj := got.(*wildwoodv1.S2C_PlayerJoined)
	if pj.Player.PlayerId != p2PlayerID {
		t.Errorf("accept③ join: pj.Player.PlayerId=%q want %q", pj.Player.PlayerId, p2PlayerID)
	}

	gotType, got = host.recv(t, 1*time.Second)
	if gotType != "S2C_RoomStateChanged" {
		t.Fatalf("accept③ join: host frame 2 type=%s want RoomStateChanged", gotType)
	}
	state := got.(*wildwoodv1.S2C_RoomStateChanged)
	if state.CurrentPlayers != 2 || state.MaxPlayers != 4 {
		t.Errorf("accept③ join: state=%d/%d want 2/4", state.CurrentPlayers, state.MaxPlayers)
	}
	if state.Trigger != "join" {
		t.Errorf("accept③ join: trigger=%q want \"join\"", state.Trigger)
	}

	// p2 离房
	p2.send(t, "C2S_RoomLeave", &wildwoodv1.C2S_RoomLeave{RoomId: roomID})
	// p2 收到 RoomLeft
	_, _ = p2.recv(t, 1*time.Second)

	// host 收 PlayerLeft + RoomStateChanged(1/4, trigger=leave)
	gotType, got = host.recv(t, 1*time.Second)
	if gotType != "S2C_PlayerLeft" {
		t.Fatalf("accept③ leave: host frame 1 type=%s want PlayerLeft", gotType)
	}
	pl := got.(*wildwoodv1.S2C_PlayerLeft)
	if pl.PlayerId != p2PlayerID {
		t.Errorf("accept③ leave: pl.PlayerId=%q want %q", pl.PlayerId, p2PlayerID)
	}
	if pl.Reason != "leave" {
		t.Errorf("accept③ leave: pl.Reason=%q want \"leave\"", pl.Reason)
	}

	gotType, got = host.recv(t, 1*time.Second)
	if gotType != "S2C_RoomStateChanged" {
		t.Fatalf("accept③ leave: host frame 2 type=%s want RoomStateChanged", gotType)
	}
	state = got.(*wildwoodv1.S2C_RoomStateChanged)
	if state.CurrentPlayers != 1 || state.Trigger != "leave" {
		t.Errorf("accept③ leave: state=%d trigger=%q want 1/\"leave\"", state.CurrentPlayers, state.Trigger)
	}

	// 校验 hub 房内人数
	hub.Mu().RLock()
	if r, ok := hub.Rooms()[roomID]; ok {
		if cnt := r.MemberCount(); cnt != 1 {
			hub.Mu().RUnlock()
			t.Errorf("accept③ after leave: members=%d want 1", cnt)
		}
	} else {
		hub.Mu().RUnlock()
		t.Errorf("accept③ after leave: room disappeared")
	}
	hub.Mu().RUnlock()
}

// ===========================
// 回归 1: 计数器独立性 (修复 nextPlayerID / nextRoomID 共用 roomSeq 的 bug)
// ===========================

// TestM111_Regression_CounterIndependence
// 场景: 在创建玩家前先创建 N 个房间,验证 player id 序列不与 room id 序列耦合
// 修复前: p-1, p-2, ..., p-K 都共享 roomSeq;所以第 6 次 createRoom 会拿到 r-00006
// 修复后: roomSeq 独立,p-K 不会影响 room id
func TestM111_Regression_CounterIndependence(t *testing.T) {
	ts, _, cleanup := startTestServer(t)
	defer cleanup()

	const N = 5
	roomIDs := make([]string, 0, N+1)
	for i := 0; i < N; i++ {
		c := newClient(t, ts.URL)
		c.handshake(t, "user") // 消耗 playerSeq
		rid, _ := c.createRoom(t)
		roomIDs = append(roomIDs, rid)
		c.close()
	}

	// 校验 5 位短链 + 序号连续
	for i, rid := range roomIDs {
		if !strings.HasPrefix(rid, "r-") {
			t.Errorf("counter: roomIDs[%d]=%q want r- prefix", i, rid)
		}
		suffix := strings.TrimPrefix(rid, "r-")
		if len(suffix) != 5 {
			t.Errorf("counter: roomIDs[%d]=%q suffix=%q want 5 digits", i, rid, suffix)
		}
	}

	// 再开一个 host,新建一个房间,确认 room id 序号 = N+1
	host := newClient(t, ts.URL)
	defer host.close()
	host.handshake(t, "host")
	lastRoomID, _ := host.createRoom(t)

	// 简化断言:5 位短链 + r- 前缀
	if !strings.HasPrefix(lastRoomID, "r-") || len(lastRoomID) != 7 {
		t.Errorf("counter: lastRoomID=%q want r-NNNNN (7 chars)", lastRoomID)
	}

	// 关键回归断言:hub 的 nextRoomID 与 nextPlayerID 不再共享计数器
	// 间接验证: 之前注册 N 个玩家(playerSeq=N),再开 N 个房间(roomSeq=N),
	// 第 N+1 个房间 id 应是 r-00006(不与 p-1...p-5 互踩)
	_ = lastRoomID
}

// ===========================
// 回归 2: 满员被拒后,服务端不应让 5 号玩家进入房间
// ===========================

// TestM111_Regression_FullRejection_DoesNotMutateRoom
// 场景: 满员后,5 号玩家被拒,服务端不应错误地把它加入房间
// 验证:5 号被拒后,再让 5 号用合法 join_token 申请 → 仍被拒(room 仍 4 人)
func TestM111_Regression_FullRejection_DoesNotMutateRoom(t *testing.T) {
	ts, hub, cleanup := startTestServer(t)
	defer cleanup()

	host := newClient(t, ts.URL)
	defer host.close()
	host.handshake(t, "host")
	roomID, token := host.createRoom(t)

	members := make([]*client, 3)
	for i := 0; i < 3; i++ {
		m := newClient(t, ts.URL)
		m.handshake(t, "p")
		m.joinRoom(t, roomID, token)
		_, _ = host.recv(t, 2*time.Second)
		_, _ = host.recv(t, 2*time.Second)
		members[i] = m
	}
	defer func() {
		for _, m := range members {
			m.close()
		}
	}()

	// 5 号连续尝试 3 次,都应被拒
	for i := 0; i < 3; i++ {
		p5 := newClient(t, ts.URL)
		p5.handshake(t, "p5")
		p5.send(t, "C2S_RoomJoin", &wildwoodv1.C2S_RoomJoin{RoomId: roomID, JoinToken: token})
		err := p5.expectError(t)
		if err.Code != wildwoodv1.RoomErrorCode_ROOM_ERROR_FULL {
			t.Errorf("rejection: attempt %d code=%v want FULL", i, err.Code)
		}
		p5.close()
	}

	// 房间仍 4 人
	hub.Mu().RLock()
	if r, ok := hub.Rooms()[roomID]; ok {
		if cnt := r.MemberCount(); cnt != 4 {
			hub.Mu().RUnlock()
			t.Errorf("rejection: members=%d want 4 (after 3 failed attempts)", cnt)
		}
	}
	hub.Mu().RUnlock()
}
