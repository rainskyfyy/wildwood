// Package room: 图鉴系统 (M2.11) — 静态数据库 + per-room 解锁状态 + 5Hz 广播.
//
// 设计要点:
//   1. CodexDatabase 编译期 hard-code 31+ 条目(M2.11 占位;M2.10 战斗系统/M2.14
//      美术资产到位后只改 stats/sprite_key,不重写 schema).
//   2. CodexState 嵌入 Room,负责:
//        - 解锁字典 entry_id -> unlock_time_ms(单调,不重置)
//        - dirty set: 5Hz ticker 消费后清空
//   3. Hub.UnlockCodex(playerID, entryID, nowMs) 单点接入钩子:
//        - M2.2 采集系统:  gather 完成
//        - M2.9 合成系统:  首次合成
//        - M2.10 战斗系统: 击杀怪物
//        - M2.13 交互:     打开箱子/工作台
//      幂等: 已解锁则 no-op,新解锁才标 dirty.
//   4. Hub.tickCodex() 200ms 周期: 扫所有房间的 dirty,广播 S2C_CodexDelta.
//   5. 字节预算: 完整 31 entries × ~120B ≈ 3.7 KB;Delta 仅 unlocked 增量 < 256B.
//
// 简化版(M2.11): 5Hz 独立 ticker,每次广播完整 unlocked 表(典型 4-50 项).
// M3.1 客户端预测+校正协议接管后会改为: 挂 WorldDelta 走 20Hz 主通道,只发 delta.
package room

import (
	"sort"
	"sync"
	"time"

	wildwoodv1 "github.com/wildwood/net/wildwood/v1"
)

// CodexTickInterval 5Hz = 200ms(M2.11 简化版)
const CodexTickInterval = 200 * time.Millisecond

// CodexTickHz 5Hz 频率(M3.1 协议统辖后会被替代)
const CodexTickHz = 5

// BuildTestDatabase 静态预置 31 条目(M2.11 占位数据)
// 字段定义详见 docs/codex/SCHEMA.md §2 与 docs/codex/seed_data.json
// M2.10 战斗系统/M2.14 美术资产完成后,数值会覆写,sprite_key 替换;但本函数不依赖
// 任何运行时数据,可保持编译期常量.
func BuildTestDatabase() []*wildwoodv1.CodexEntry {
	return []*wildwoodv1.CodexEntry{
		// -------------------- 生物 (8, 对齐 M2.10 5+ 怪物) --------------------
		mkEntry("creature.tree_sprite", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1001,
			"树精", "Arborea Maledicta", 1,
			[]string{"HP: 120", "攻击: 25", "防御: 8", "移速: 2.5", "季节: 秋冬", "食物: 0"},
			"白天静止伪装,黄昏起追击,夜深回家。攻击距离 32px。",
			"用火把点燃 3 次击退,白天绕行可避免。",
			[]string{"item.log", "item.twig"}),
		mkEntry("creature.spider", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1002,
			"蜘蛛", "Aranea Venenata", 0,
			[]string{"HP: 60", "攻击: 15", "防御: 3", "移速: 3.0", "季节: 春夏", "食物: 0"},
			"三只一组群居,白天筑巢,夜间主动攻击。",
			"火把可驱散,白天绕行。",
			[]string{"item.spider_gland", "item.silk"}),
		mkEntry("creature.bat", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1003,
			"蝙蝠", "Chiroptera Umbra", 0,
			[]string{"HP: 30", "攻击: 8", "防御: 1", "移速: 4.0", "季节: 全", "食物: 0"},
			"夜间成群出没,白天洞穴悬停。主动攻击需靠近。",
			"任何武器一击,数量多但脆弱。",
			[]string{"item.bat_wing"}),
		mkEntry("creature.hound", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1004,
			"猎犬", "Canis Diripiens", 1,
			[]string{"HP: 90", "攻击: 22", "防御: 5", "移速: 3.5", "季节: 秋冬", "食物: 0"},
			"群体狩猎,仇恨锁定,无固定营地。",
			"群体可逐个击破,带火把减速。",
			[]string{"item.hound_tooth", "item.meat"}),
		mkEntry("creature.merm", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1005,
			"鱼人", "Piscis Hominis", 1,
			[]string{"HP: 100", "攻击: 28", "防御: 6", "移速: 2.8", "季节: 春夏", "食物: 0"},
			"沼泽地巡逻,主动进入视野,远程扔鱼骨。",
			"近战打断攻击,带武器绕背。",
			[]string{"item.fish", "item.bone"}),
		mkEntry("creature.deerclops", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1006,
			"巨鹿", "Cervus Magnus", 3,
			[]string{"HP: 800", "攻击: 75", "防御: 20", "移速: 4.5", "季节: 冬", "食物: 0"},
			"冬季 Boss,每 3 天巡视一次雪原。破坏建筑。",
			"打 3 眼击退,带护甲和食物。",
			[]string{"item.deer_antler", "item.meat"}),
		mkEntry("creature.tentacle", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1007,
			"触须", "Tentaculus Profundus", 2,
			[]string{"HP: 250", "攻击: 35", "防御: 10", "移速: 0", "季节: 全", "食物: 0"},
			"沼泽地里潜伏,靠近水面时伸长攻击。",
			"诱饵钓离水面,集火击杀。",
			[]string{"item.tentacle_spot"}),
		mkEntry("creature.lureplant", wildwoodv1.CodexCategory_CODEX_CATEGORY_CREATURE, 1008,
			"食人花", "Planta Carnivora", 2,
			[]string{"HP: 150", "攻击: 50", "防御: 8", "移速: 0", "季节: 全", "食物: 0"},
			"伪装成浆果,玩家靠近时一口吞下。",
			"看清脚下,带武器先发制人。",
			[]string{"item.lureplant_bulb"}),

		// -------------------- 资源 (10, 对齐 M2.2 10+ 资源) --------------------
		mkEntry("item.berry", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2001,
			"浆果", "Bacca Sylvestris", 0,
			[]string{"产出: 1-3", "工具: 无", "季节: 夏", "群系: 森林", "再生: 2天", "价值: 1"},
			"灌木丛上,走过自动拾取,采集后 2 天再生。",
			"食人花会伪装成浆果灌木,仔细分辨。",
			nil),
		mkEntry("item.mushroom", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2002,
			"蘑菇", "Fungus Sylvestris", 0,
			[]string{"产出: 1", "工具: 无", "季节: 秋", "群系: 森林", "再生: 3天", "价值: 1"},
			"雨后生出,夜间发光,直接拾取。",
			"绿蘑菇减精神,挑红蓝采摘。",
			nil),
		mkEntry("item.reed", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2003,
			"芦苇", "Arundo Palustris", 0,
			[]string{"产出: 1-2", "工具: 镰", "季节: 全", "群系: 沼泽", "再生: 1天", "价值: 1"},
			"沼泽地水边成片生长,镰刀采集效率翻倍。",
			"无,纯材料。",
			nil),
		mkEntry("item.sapling", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2004,
			"树苗", "Arbor Parva", 0,
			[]string{"产出: 1", "工具: 铲", "季节: 春", "群系: 森林", "再生: 5天", "价值: 1"},
			"用铲挖出,可种植。",
			"冬天不生长。",
			nil),
		mkEntry("item.flint", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2005,
			"燧石", "Silex Nodus", 0,
			[]string{"产出: 1", "工具: 镐", "季节: 全", "群系: 沙漠/平原", "再生: 4天", "价值: 1"},
			"地面散落,镐采 1 颗,斧采效率低。",
			"沙漠群系密度最高。",
			nil),
		mkEntry("item.bone", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2006,
			"骨头", "Os Antiquum", 0,
			[]string{"产出: 1", "工具: 铲", "季节: 全", "群系: 全", "再生: 6天", "价值: 1"},
			"墓地区或牛/鱼人掉落,铲挖掘。",
			"无。",
			nil),
		mkEntry("item.grass", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2007,
			"草", "Herba Communis", 0,
			[]string{"产出: 1", "工具: 镰", "季节: 全", "群系: 草原", "再生: 1天", "价值: 1"},
			"地面成片,镰刀效率高。",
			"无。",
			nil),
		mkEntry("item.twig", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2008,
			"木棍", "Ramus Parvus", 0,
			[]string{"产出: 1-2", "工具: 斧", "季节: 全", "群系: 森林", "再生: 1天", "价值: 1"},
			"树上小枝,斧砍下,基础材料。",
			"无。",
			nil),
		mkEntry("item.ore_stone", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2009,
			"石矿", "Petra Metallum", 0,
			[]string{"产出: 1-2", "工具: 镐", "季节: 全", "群系: 矿区", "再生: 5天", "价值: 1"},
			"大块岩石,镐采 2 块,基础材料。",
			"需镐,徒手无效。",
			nil),
		mkEntry("item.ore_gold", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 2010,
			"金矿", "Aurum Nidus", 1,
			[]string{"产出: 1", "工具: 镐", "季节: 全", "群系: 矿区", "再生: 8天", "价值: 5"},
			"稀有矿石,冬季出现率上升。",
			"需镐,徒手无效。",
			nil),

		// -------------------- 工具 (5) --------------------
		mkEntry("item.axe", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 3001,
			"伐木斧", "Securis Lignum", 0,
			[]string{"耐久: 100", "攻击: 27", "采集: 木", "速度: +50%", "特殊: 无", "价值: 5"},
			"砍树效率 +50%,近战伤害 27。",
			"不可挖矿,不可割草。",
			nil),
		mkEntry("item.pickaxe", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 3002,
			"镐", "Dolabra Petra", 0,
			[]string{"耐久: 100", "攻击: 25", "采集: 矿", "速度: +50%", "特殊: 无", "价值: 5"},
			"挖矿效率 +50%,近战伤害 25。",
			"不可砍树。",
			nil),
		mkEntry("item.shovel", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 3003,
			"铲", "Pala Terra", 0,
			[]string{"耐久: 75", "攻击: 17", "采集: 挖", "速度: +50%", "特殊: 无", "价值: 3"},
			"挖树苗/骨头/草效率 +50%,伤害低。",
			"不可挖矿。",
			nil),
		mkEntry("item.hoe", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 3004,
			"锄", "Sarculum Humus", 0,
			[]string{"耐久: 75", "攻击: 15", "采集: 农", "速度: +50%", "特殊: 无", "价值: 3"},
			"翻土耕种用,前置农业。",
			"不可砍树挖矿。",
			nil),
		mkEntry("item.torch", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 3005,
			"火把", "Fax Lumen", 0,
			[]string{"耐久: 75", "攻击: 10", "采集: 无", "速度: 0", "特殊: 光+15", "价值: 1"},
			"手持发光半径 15,点燃树精/蜘蛛,夜间必备。",
			"被雨淋熄。",
			nil),

		// -------------------- 建筑 (5) --------------------
		mkEntry("item.campfire", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 4001,
			"营火", "Ignis Domus", 0,
			[]string{"HP: 80", "范围: 8", "容纳: 1", "燃料: 木", "价值: 0", "特殊: 烹饪"},
			"基础光源与烹饪,周围 8 范围温度提升。",
			"下雨熄灭,需持续加燃料。",
			nil),
		mkEntry("item.chest", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 4002,
			"箱子", "Cista Thesauri", 0,
			[]string{"HP: 100", "范围: 0", "容纳: 9", "燃料: 无", "价值: 0", "特殊: 共享"},
			"9 格存储,E 键打开,队伍共享。",
			"可被敌人破坏,放基地内。",
			nil),
		mkEntry("item.workbench", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 4003,
			"工作台", "Mensa Opifex", 0,
			[]string{"HP: 100", "范围: 0", "容纳: 0", "燃料: 无", "价值: 0", "特殊: 工具合成"},
			"工具类配方合成门槛,放后激活对应配方。",
			"无,必须先建。",
			nil),
		mkEntry("item.cookpot", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 4004,
			"烹饪锅", "Ollae Coquus", 0,
			[]string{"HP: 80", "范围: 0", "容纳: 4", "燃料: 木", "价值: 0", "特殊: 食物合成"},
			"食物配方合成门槛,需放营地旁。",
			"需燃料,无限运作。",
			nil),
		mkEntry("item.tent", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 4005,
			"帐篷", "Tentorium Itinera", 0,
			[]string{"HP: 120", "范围: 0", "容纳: 1", "燃料: 无", "价值: 0", "特殊: 重生点"},
			"个人重生点,死亡后回此点。",
			"可被破坏,放基地内。",
			nil),

		// -------------------- 食物 (3, 30+ 配方衍生) --------------------
		mkEntry("item.berry_cooked", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 5001,
			"烤浆果", "Bacca Assata", 0,
			[]string{"饱腹: +20", "精神: +5", "生命: 0", "时效: 10天", "毒素: 0", "价值: 3"},
			"生浆果烤制,饱腹+20。",
			"无。",
			nil),
		mkEntry("item.meat_cooked", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 5002,
			"烤肉", "Caro Assata", 0,
			[]string{"饱腹: +30", "精神: -5", "生命: +3", "时效: 6天", "毒素: 0", "价值: 5"},
			"猎犬/鱼人/鹿肉烤制,生命+3。",
			"精神-5,植物人避免。",
			nil),
		mkEntry("item.meatballs", wildwoodv1.CodexCategory_CODEX_CATEGORY_ITEM, 5003,
			"肉丸", "Globulus Carnis", 0,
			[]string{"饱腹: +60", "精神: +10", "生命: 0", "时效: 15天", "毒素: 0", "价值: 10"},
			"肉+浆果+冰合成,保质期长,高品质食物。",
			"需烹饪锅 + 冰。",
			nil),
	}
}

// mkEntry 构造器 — 减少 31 行 × 11 字段的视觉噪音
func mkEntry(id string, cat wildwoodv1.CodexCategory, prefab uint32,
	name, sci string, rarity uint32,
	stats []string, behavior, weakness string,
	drops []string,
) *wildwoodv1.CodexEntry {
	return &wildwoodv1.CodexEntry{
		EntryId:        id,
		Category:       cat,
		PrefabId:       prefab,
		DisplayName:    name,
		ScientificName: sci,
		SpriteKey:      "TBD_64", // M2.14 美术出图后替换
		Stats:          stats,
		Behavior:       behavior,
		Weakness:       weakness,
		DropTable:      drops,
		Rarity:         rarity,
	}
}

// CodexState per-room 解锁状态(单调,不重置).
//
// 字段:
//   - Unlocked:   entry_id -> unlock_time_ms(已解锁)
//   - Dirty:      5Hz ticker 扫完后清空
//   - SnapshotBytes: 5Hz 广播字节预算 < 256B(典型 4-50 项 unlocked,protobuf 编码)
//   - mu:         RWMutex(读多写少:读广播,写解锁)
type CodexState struct {
	mu         sync.RWMutex
	Unlocked   map[string]uint64
	Dirty      map[string]struct{}
}

// NewCodexState 构造(per room)
func NewCodexState() *CodexState {
	return &CodexState{
		Unlocked: make(map[string]uint64),
		Dirty:    make(map[string]struct{}),
	}
}

// Unlock 解锁 entry;若已解锁则 no-op,返回是否新解锁.
// M2.2/M2.9/M2.10 通过 Hub.UnlockCodex → Room.codex.Unlock 调用本方法.
func (cs *CodexState) Unlock(entryID string, nowMs uint64) bool {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if _, ok := cs.Unlocked[entryID]; ok {
		return false
	}
	cs.Unlocked[entryID] = nowMs
	cs.Dirty[entryID] = struct{}{}
	return true
}

// IsUnlocked 查询(供 UI / 测试)
func (cs *CodexState) IsUnlocked(entryID string) bool {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	_, ok := cs.Unlocked[entryID]
	return ok
}

// Count 已解锁条目数(测试用)
func (cs *CodexState) Count() int {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return len(cs.Unlocked)
}

// DrainDirty 取并清空 dirty set(5Hz ticker 调用)
// 返回 5Hz 增量 entry_id 列表(若空则不广播)
func (cs *CodexState) DrainDirty() []string {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if len(cs.Dirty) == 0 {
		return nil
	}
	ids := make([]string, 0, len(cs.Dirty))
	for id := range cs.Dirty {
		ids = append(ids, id)
	}
	cs.Dirty = make(map[string]struct{})
	// 排序保证确定性(测试稳定)
	sort.Strings(ids)
	return ids
}

// SnapshotUnlocked 返回完整已解锁表(供 5Hz 广播用,M2.11 简化版)
func (cs *CodexState) SnapshotUnlocked() []*wildwoodv1.CodexUnlock {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	if len(cs.Unlocked) == 0 {
		return nil
	}
	ids := make([]string, 0, len(cs.Unlocked))
	for id := range cs.Unlocked {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]*wildwoodv1.CodexUnlock, 0, len(ids))
	for _, id := range ids {
		out = append(out, &wildwoodv1.CodexUnlock{
			EntryId:       id,
			UnlockTimeMs:  cs.Unlocked[id],
		})
	}
	return out
}

// HasDirty 5Hz ticker 决定是否要广播
func (cs *CodexState) HasDirty() bool {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return len(cs.Dirty) > 0
}

// BuildCodexSync 构造加入时的全量同步消息(static database + 当前 unlocked)
// 用于新玩家 join 时一次性发给 ta(后续 5Hz 走 Delta).
func BuildCodexSync(serverTick uint32, serverTimeMs uint64) *wildwoodv1.S2C_CodexSync {
	return &wildwoodv1.S2C_CodexSync{
		ServerTick:    serverTick,
		ServerTimeMs:  serverTimeMs,
		Database:      BuildTestDatabase(),
		Unlocked:      nil, // join 时通常为空;若房间已有历史解锁,S2C_CodexSync 一次性补齐
	}
}

// BuildCodexDelta 构造 5Hz 增量广播消息(完整 unlocked 表,简化版)
// 简化版(M2.11): 每次发完整 unlocked 列表,典型 4-50 项 < 256B
// M3.1 协议统辖后,会改为只发 entry_id 增量
func BuildCodexDelta(serverTick uint32, serverTimeMs uint64, unlocked []*wildwoodv1.CodexUnlock) *wildwoodv1.S2C_CodexDelta {
	return &wildwoodv1.S2C_CodexDelta{
		ServerTick:    serverTick,
		ServerTimeMs:  serverTimeMs,
		UnlockedFull:  unlocked,
	}
}
