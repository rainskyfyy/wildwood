// Package room: 服务端 GATHER 处理 + 移动位置更新 (M2.1 + M2.2)
//
// 任务映射:
//   - M2.1 验收 ① 移动 200ms 内响应 → handlePlayerInput(MOVE) 直接更新 Player.PosX/Y
//   - M2.1 验收 ② LMB 智能判别 → 由 GDScript 客户端在发送前判别 action,服务端不参与
//   - M2.1 验收 ③ 移动时 sprite 朝向 → 客户端处理,服务端只同步 facing
//
//   - M2.2 验收 ① 10+ 资源类型 1.5s ± 100ms → DefaultResourceConfigs.GatherTimeMS=1500
//   - M2.2 验收 ② 进度条 0→100% 平滑 → 客户端按服务端 ack_seq + elapsed 计算
//   - M2.2 验收 ③ 采集时 sprite 抖动 → 客户端处理(读 ResourceState.HP 变化触发)
//   - M2.2 验收 ④ 联机下资源 HP 同步 → tick 推进采集 → S2C_WorldDelta.entity_updates
//
// 关键决策:
//   - 客户端 LMB 时先做智能判别(距离最近的可交互实体),决定 action 后只发一个 C2S_PlayerInput
//   - 服务端对 GATHER 不"立即扣 HP",而是启动 1.5s 倒计时;倒计时由 tick 推进
//   - 中断支持:玩家新一次 MOVE / 走出 ReachPixels / 切换 GATHER 目标,旧进度失效
package room

import (
	"fmt"
	"math"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
	"google.golang.org/protobuf/proto"
)

// =====================================================================
// 距离 / 触达判定(纯函数,便于测试)
// =====================================================================

// DistancePx 平方距离(避免 sqrt)
func DistancePx(ax, ay, bx, by float32) float32 {
	dx := ax - bx
	dy := ay - by
	return dx*dx + dy*dy
}

// InReachPx 玩家到资源中心是否在 ReachPixels 范围内
func InReachPx(px, py, rx, ry, reachPx float32) bool {
	d2 := DistancePx(px, py, rx, ry)
	return d2 <= reachPx*reachPx
}

// =====================================================================
// Room 上的扩展方法:World / 采集
// =====================================================================

// InitWorld 给房间初始化世界状态 + 默认资源布局
//
// 默认布局:在 (0,0) 周围 spawn 一组资源,每种至少 1 个,确保 M2.2 验收 ① 10+ 类型
// 真实游戏中由 M2.7 生物群系 spawner 接管
func (r *Room) InitWorld() {
	if r.World == nil {
		r.World = NewWorld()
	}
	// 12 种资源各 spawn 1 个,grid 排布
	types := AllResourceTypes()
	for i, t := range types {
		// 简易排布:横向 8 个一行,纵向后排
		col := float32(i % 6)
		row := float32(i / 6)
		x := 64.0 + col*128.0
		y := 64.0 + row*128.0
		_, _ = r.World.SpawnResource(t, x, y)
	}
}

// TickGather 推进所有进行中的采集
//   - 在 hub.tickLoop 中每 50ms 调用一次
//   - 完成一次采集 = 扣 1 HP;HP=0 时移除资源
//   - 完成后通过 S2C_WorldDelta 同步 entity_updates + 1 个 S2C_WorldEvent.GATHER_DONE
//
// 返回:本 tick 需要广播的 entity_updates 与 events(供 hub 整合到 S2C_WorldDelta)
func (r *Room) TickGather(now time.Time) (entityUpdates []ResourceState, events []*wildwoodv1.WorldEvent) {
	if r.World == nil {
		return nil, nil
	}
	inProg := r.World.ListInProgress()
	for _, g := range inProg {
		if now.Before(g.ExpiresAt) {
			continue
		}
		// 倒计时到:扣 1 HP
		res, ok := r.World.GetResource(g.ResourceID)
		if !ok {
			// 资源已被移除(可能 4 人同时采集同一资源,其他玩家先扣完)
			r.World.ClearGatherProgress(g.PlayerID)
			continue
		}
		cfg, ok := DefaultResourceConfigs[res.PrefID]
		if !ok {
			r.World.ClearGatherProgress(g.PlayerID)
			continue
		}
		// 扣 HP
		if res.HP > 0 {
			res.HP--
		}
		entityUpdates = append(entityUpdates, res.State())
		// 事件:谁采了哪个资源
		events = append(events, &wildwoodv1.WorldEvent{
			EventId:         uint32(now.UnixNano() & 0xFFFFFFFF),
			EventKind:       wildwoodv1.WorldEventKind_WORLD_EVENT_GATHER_DONE,
			SourceEntityId:  0, // 来源是玩家,但 entity_id 暂用 player_id 字符串存放下方
			TargetEntityId:  res.ID,
			Amount:          1,
			Position:        &wildwoodv1.Vec2F{X: res.PosX, Y: res.PosY},
		})
		// HP=0 或资源本身 HP=1 → 完成
		if res.HP == 0 {
			// 移除或重生
			if cfg.RespawnAfterMS > 0 {
				// 标记已采完(暂时移除,留给 hub tick 复活)
				res.HP = 0
				res.SpawnedAt = now // 复用 SpawnedAt 记录"采完时刻"
				// 不真正删除;改为 HP=0 让客户端隐藏,等待 respawn tick
			} else {
				r.World.RemoveResource(res.ID)
			}
		}
		// 清除这次进度(玩家需要重新发起采集)
		r.World.ClearGatherProgress(g.PlayerID)
	}
	return
}

// TickRespawn 推进可重生资源的 respawn 计时
//   - HP=0 且 RespawnAfterMS>0 的资源,距离 SpawnedAt 超过 respawn 间隔 → 重生
//   - 调用方:hub tickLoop
func (r *Room) TickRespawn(now time.Time) (entityUpdates []ResourceState) {
	if r.World == nil {
		return nil
	}
	for _, res := range r.World.resources {
		if res.HP > 0 || res.MaxHP == 0 {
			continue
		}
		cfg, ok := DefaultResourceConfigs[res.PrefID]
		if !ok || cfg.RespawnAfterMS == 0 {
			continue
		}
		elapsed := now.Sub(res.SpawnedAt)
		if elapsed < time.Duration(cfg.RespawnAfterMS)*time.Millisecond {
			continue
		}
		// 重生
		res.HP = res.MaxHP
		res.SpawnedAt = now
		entityUpdates = append(entityUpdates, res.State())
	}
	return
}

// =====================================================================
// 服务端 M2.1 移动 + M2.2 采集输入处理
// =====================================================================

// HandlePlayerInputGather 处理客户端 GATHER 输入
//   - m.Action == INPUT_ACTION_GATHER
//   - m.TargetEntityId 指向资源
//   - 距离判定:玩家 → 资源;超出 ReachPixels 返回 ROOM_ERROR_INVALID_INPUT
//   - 已在采集其他资源:覆盖
//
// 行为:
//  1. 校验玩家已在房间
//  2. 校验资源存在
//  3. 校验距离
//  4. 创建/覆盖 GatherProgress
//  5. 回 S2C_WorldDelta(acked_input_seq)
func (h *Hub) HandlePlayerInputGather(p *Player, r *Room, m *wildwoodv1.C2S_PlayerInput) error {
	if r.World == nil {
		return sendError(p.Conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT, "world not initialized", p.ID)
	}
	res, ok := r.World.GetResource(m.TargetEntityId)
	if !ok {
		// 资源已被采完(可能 4 人同时采同一资源)
		return sendError(p.Conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT,
			fmt.Sprintf("resource %d not found", m.TargetEntityId), p.ID)
	}
	if res.HP == 0 {
		return sendError(p.Conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT,
			fmt.Sprintf("resource %d depleted", m.TargetEntityId), p.ID)
	}
	cfg, ok := DefaultResourceConfigs[res.PrefID]
	if !ok {
		return sendError(p.Conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT,
			"unknown resource type", p.ID)
	}
	// 距离判定
	playerPos := p.Position() // 玩家位置(取自 Player.PosX/Y,M2.1 MOVE 维护)
	if !InReachPx(playerPos.X, playerPos.Y, res.PosX, res.PosY, float32(cfg.ReachPixels)) {
		return sendError(p.Conn, wildwoodv1.RoomErrorCode_ROOM_ERROR_INVALID_INPUT,
			fmt.Sprintf("resource %d out of reach (player=%.0f,%.0f res=%.0f,%.0f reach=%d)",
				m.TargetEntityId, playerPos.X, playerPos.Y, res.PosX, res.PosY, cfg.ReachPixels),
			p.ID)
	}
	// 创建/覆盖进度
	now := time.Now()
	gp := &GatherProgress{
		PlayerID:    p.ID,
		ResourceID:  res.ID,
		StartTimeMS: uint64(now.UnixMilli()),
		DurationMS:  cfg.GatherTimeMS,
		ExpiresAt:   now.Add(time.Duration(cfg.GatherTimeMS) * time.Millisecond),
	}
	r.World.SetGatherProgress(gp)
	// 回 S2C_WorldDelta(acked_input_seq)
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:     h.currentTick,
		ServerTimeMs:   uint64(now.UnixMilli()),
		AckedInputSeqs: []uint32{m.InputSeq},
		// 资源 HP 不变(采集没完成)
		// 玩家位置(可带 facing)
	}
	r.BroadcastExcept(encodeFrame("S2C_WorldDelta", delta), p.ID)
	_ = p.Conn.Send("S2C_WorldDelta", delta)
	return nil
}

// HandlePlayerInputMove 处理客户端 MOVE 输入(M2.1)
//   - 更新玩家位置(px/py)
//   - 朝向
//   - 玩家移动会取消当前采集(走出 ReachPixels)
//   - 广播 entity_updates(player) 给全队
func (h *Hub) HandlePlayerInputMove(p *Player, r *Room, m *wildwoodv1.C2S_PlayerInput) error {
	// 简单 clamp 到 -1..1
	dx := m.MoveDx
	dy := m.MoveDy
	if dx < -1 {
		dx = -1
	}
	if dx > 1 {
		dx = 1
	}
	if dy < -1 {
		dy = -1
	}
	if dy > 1 {
		dy = 1
	}
	// 移动速度:200 px/s(单帧 50ms 推进 10 px)
	const moveSpeedPxPerSec = 200.0
	// 简化:用 input 自带 client_time 计算,但更稳妥是用 server tick 间隔
	// 用 50ms 推进
	const dtSec = 0.05
	p.PosX += dx * moveSpeedPxPerSec * dtSec
	p.PosY += dy * moveSpeedPxPerSec * dtSec
	if m.Facing > 0 {
		p.Facing = m.Facing
	}
	// 移动 → 取消当前采集
	if r.World != nil {
		r.World.ClearGatherProgress(p.ID)
	}
	// 广播:玩家位置 + 取消采集的 input ack
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:     h.currentTick,
		ServerTimeMs:   uint64(time.Now().UnixMilli()),
		AckedInputSeqs: []uint32{m.InputSeq},
		EntityUpdates: []*wildwoodv1.EntityState{
			{
				EntityId: 0, // 玩家 entity_id = 0(预留);player_id 字段标识
				Kind:     wildwoodv1.EntityKind_ENTITY_KIND_PLAYER,
				Position: &wildwoodv1.Vec2F{X: p.PosX, Y: p.PosY},
				Facing:   p.Facing,
				Hp:       100,
				MaxHp:    100,
				PlayerId: p.ID,
			},
		},
	}
	r.Broadcast(encodeFrame("S2C_WorldDelta", delta))
	return nil
}

// HandlePlayerInputAttack 处理客户端 ATTACK 输入(M2.10 范围;这里只占位防 protocol 丢帧)
func (h *Hub) HandlePlayerInputAttack(p *Player, r *Room, m *wildwoodv1.C2S_PlayerInput) error {
	// M2.10 战斗系统实现完整攻击;这里只 ack
	delta := &wildwoodv1.S2C_WorldDelta{
		ServerTick:     h.currentTick,
		ServerTimeMs:   uint64(time.Now().UnixMilli()),
		AckedInputSeqs: []uint32{m.InputSeq},
	}
	r.Broadcast(encodeFrame("S2C_WorldDelta", delta))
	return nil
}

// BuildWorldDeltaForResources 把 internal ResourceState 转 protobuf EntityState
func BuildWorldDeltaForResources(states []ResourceState) []*wildwoodv1.EntityState {
	out := make([]*wildwoodv1.EntityState, 0, len(states))
	for _, s := range states {
		out = append(out, &wildwoodv1.EntityState{
			EntityId: s.EntityId,
			Kind:     wildwoodv1.EntityKind_ENTITY_KIND_RESOURCE,
			Position: &wildwoodv1.Vec2F{X: s.PosX, Y: s.PosY},
			Hp:       s.HP,
			MaxHp:    s.MaxHP,
			PrefabId: s.PrefID,
		})
	}
	return out
}

// =====================================================================
// 资源在 tick 中"按时间衰减"防作弊(简化,可选)
// =====================================================================

// elapsedMS 计算一个采集已经进行多久(毫秒)
func elapsedMS(startMS uint64, now time.Time) uint32 {
	nowMS := uint64(now.UnixMilli())
	if nowMS <= startMS {
		return 0
	}
	diff := nowMS - startMS
	if diff > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(diff)
}

// Compile-time guard
var _ = proto.Marshal
