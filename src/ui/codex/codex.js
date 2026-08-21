/* Wildwood UI · 图鉴系统 (M2.11)
 * 双 Tab (生物 / 物品) + 64px 插画 + 6 属性 + 行为/克制 + 5Hz 解锁广播
 *
 * 5Hz 状态同步抽象 (LocalStateBus):
 *   - 接口契约与 M2.12 计划的 EventTarget 抽象一致
 *   - M2.12 提交后,直接替换为 M2.12 的抽象,本模块调用点不变
 *   - 当前 M2.12 未交付,先建本地 mock 演示
 *
 * 不依赖任何外部 JS 框架,纯 ES Module
 */

import { bootGame } from "../../main.js"; // 占位,本模块不直接用,保留以备 M2.13 整合

// ============================================================================
// 5Hz 状态同步抽象 (本地 mock 版 · 与 M2.12 计划对齐)
// ============================================================================

const TICK_MS = 200; // 5Hz = 每秒 5 次 = 200ms

class LocalStateBus {
  constructor() {
    this.target = new EventTarget();
    this._tick = null;
    this._tickCount = 0;
    this._listeners = new Set();
  }

  /** 订阅事件,返回取消订阅函数 */
  subscribe(event, handler) {
    const wrapped = (e) => handler(e.detail);
    this.target.addEventListener(event, wrapped);
    this._listeners.add({ event, wrapped, handler });
    return () => {
      this.target.removeEventListener(event, wrapped);
      this._listeners.delete(event, wrapped, handler);
    };
  }

  /** 发布事件 */
  publish(event, data) {
    this.target.dispatchEvent(new CustomEvent(event, { detail: data }));
  }

  /** 启动 5Hz 心跳(mock 模式:周期性触发一次 unlock) */
  startMockBroadcast(intervalTicks = 6) {
    if (this._tick) return;
    this._tick = setInterval(() => {
      this._tickCount++;
      this.publish("tick", { count: this._tickCount, ts: Date.now() });
      // 每 N 次 tick 模拟一次"击杀广播"
      if (this._tickCount % intervalTicks === 0) {
        this._simulateUnlock();
      }
    }, TICK_MS);
  }

  stop() {
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
  }

  get tickCount() { return this._tickCount; }

  /** 模拟击杀:由 CodexUI 注册,负责挑一个未解锁的 id 解锁 */
  _simulateUnlock() {
    this.publish("broadcast:unlock", { ts: Date.now() });
  }
}

// 全局单例
const bus = new LocalStateBus();
// 暴露给 demo 控制台 / M2.12 后续替换
if (typeof window !== "undefined") window.__wildwoodCodexBus = bus;

// ============================================================================
// Mock 数据 · 12 生物 + 12 物品 (M2.14 美术到位后,只换 art 字段)
// ============================================================================

const CREATURES = [
  { id: "hound",       name: "猎犬",        sci: "Canis vorax",     art: null, hp: 60,  atk: 12, def: 4,  spd: 8, res: "无",      behavior: "群居,黄昏出没,主动追击 8 格内目标",  counter: "保持距离,绕树周旋;火烧可驱散" },
  { id: "spider",      name: "巨魔蜘蛛",    sci: "Arachne nox",     art: null, hp: 100, atk: 20, def: 6,  spd: 5, res: "无",      behavior: "伏击型,玩家进入 4 格触发",           counter: "提前探路(火把/光源),硬直期 1.5s" },
  { id: "bat",         name: "洞穴蝙蝠",    sci: "Vesper caecus",   art: null, hp: 35,  atk: 8,  def: 2,  spd: 12,res: "无",      behavior: "夜行,群体盘旋,降低玩家理智",       counter: "戴矿灯/帽子,攻击前摇 0.4s" },
  { id: "merm",        name: "鱼人守卫",    sci: "Homo piscis",     art: null, hp: 90,  atk: 18, def: 8,  spd: 6, res: "水",      behavior: "水域巡逻,远离水源失攻速 30%",       counter: "拖离水域,无近战时背水 1v1" },
  { id: "treant",      name: "古树守卫",    sci: "Arbor senex",     art: null, hp: 380, atk: 35, def: 18, spd: 2, res: "火-50%", behavior: "静止不动,玩家砍 3 棵树后激活",      counter: "用火烧(减抗),群体 3 人分摊仇恨" },
  { id: "hound_winter",name: "雪原猎犬",    sci: "Canis hiems",     art: null, hp: 75,  atk: 15, def: 6,  spd: 9, res: "寒",     behavior: "雪原群系专属,冰冻减速攻击",          counter: "带保暖(火把/衣物),绕到背后" },
  // 锁
  { id: "spider_queen",name: "??",          sci: "??",              art: null, hp: 0,   atk: 0,  def: 0,  spd: 0, res: "??",     behavior: "??",                                 counter: "??" },
  { id: "treant_ancient",name:"??",         sci: "??",              art: null, hp: 0,   atk: 0,  def: 0,  spd: 0, res: "??",     behavior: "??",                                 counter: "??" },
  { id: "ghost",       name: "??",          sci: "??",              art: null, hp: 0,   atk: 0,  def: 0,  spd: 0, res: "??",     behavior: "??",                                 counter: "??" },
  { id: "deerclops",   name: "??",          sci: "??",              art: null, hp: 0,   atk: 0,  def: 0,  spd: 0, res: "??",     behavior: "??",                                 counter: "??" },
  { id: "bearger",     name: "??",          sci: "??",              art: null, hp: 0,   atk: 0,  def: 0,  spd: 0, res: "??",     behavior: "??",                                 counter: "??" },
  { id: "malbatross",  name: "??",          sci: "??",              art: null, hp: 0,   atk: 0,  def: 0,  spd: 0, res: "??",     behavior: "??",                                 counter: "??" },
];

const ITEMS = [
  { id: "twigs",       name: "树枝",        sci: "Ramulus siccus",  art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "可燃",     behavior: "基础资源,3 棵 = 1 捆",                counter: "直接拾取,无危险" },
  { id: "flint",       name: "燧石",        sci: "Silicis lapillus",art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "可燃",     behavior: "基础资源,概率刷新于沙漠/雪原",       counter: "拾取,合成斧/镐" },
  { id: "log",         name: "圆木",        sci: "Truncus",         art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "可燃",     behavior: "基础资源,1 棵树 = 2 圆木",            counter: "持斧砍伐,需 1.5s" },
  { id: "axe",         name: "斧头",        sci: "Ascia ferrea",    art: null, hp: 40,atk: 8, def: 0,  spd: 0, res: "可燃",     behavior: "砍树/挖矿双用,耐久 20",              counter: "持握右键砍树" },
  { id: "pickaxe",     name: "镐子",        sci: "Dolabra",         art: null, hp: 60,atk: 6, def: 0,  spd: 0, res: "可燃",     behavior: "挖掘矿石/燧石,耐久 25",              counter: "对燧石/金/石头右键" },
  { id: "torch",       name: "火把",        sci: "Fax ardens",      art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "可燃",     behavior: "照明 + 驱虫 + 范围 6 照明",           counter: "右键放置,持续 90s" },
  // 锁
  { id: "spear",       name: "??",          sci: "??",              art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "??",      behavior: "??",                                 counter: "??" },
  { id: "ham_bat",     name: "??",          sci: "??",              art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "??",      behavior: "??",                                 counter: "??" },
  { id: "armor_wood",  name: "??",          sci: "??",              art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "??",      behavior: "??",                                 counter: "??" },
  { id: "heal_salve",  name: "??",          sci: "??",              art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "??",      behavior: "??",                                 counter: "??" },
  { id: "lantern",     name: "??",          sci: "??",              art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "??",      behavior: "??",                                 counter: "??" },
  { id: "tent",        name: "??",          sci: "??",              art: null, hp: 0, atk: 0, def: 0,  spd: 0, res: "??",      behavior: "??",                                 counter: "??" },
];

// 初始已解锁集合(开局 6 生物 + 6 物品已登记,具体内容按玩家进度解锁)
const INIT_UNLOCKED = {
  creatures: new Set(["hound", "spider", "bat", "merm", "treant", "hound_winter"]),
  items:     new Set(["twigs", "flint", "log", "axe", "pickaxe", "torch"]),
  recipes:   new Set(),   // v0.5.3 烹饪 — 启动时从 window.__wildwoodRecipes.INIT_UNLOCKED 同步
};

// ============================================================================
// 状态机
// ============================================================================

const state = {
  tab: "creatures",            // 当前 Tab (creatures | items | recipes)
  recipesSub: "category",      // recipes 子 Tab (category | quality)
  unlocked: {
    creatures: new Set(INIT_UNLOCKED.creatures),
    items:     new Set(INIT_UNLOCKED.items),
    recipes:   new Set(INIT_UNLOCKED.recipes),
  },
  justUnlocked: new Set(),     // 解锁瞬间的 ID(脉冲高亮 1.2s 后清除)
  currentDetail: null,         // 当前打开的详情
};

// v0.5.3 烹饪: 启动时把 recipes.js 的初始解锁条目同步进来
if (typeof window !== "undefined" && window.__wildwoodRecipes && window.__wildwoodRecipes.INIT_UNLOCKED) {
  for (const id of window.__wildwoodRecipes.INIT_UNLOCKED) state.unlocked.recipes.add(id);
}

// ============================================================================
// 渲染层
// ============================================================================

const els = {};

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v === false || v == null) {}
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// 6 属性键(共享表头,Tab 间一致)
const STAT_KEYS = [
  { key: "hp",  label: "HP"  },
  { key: "atk", label: "ATK" },
  { key: "def", label: "DEF" },
  { key: "spd", label: "SPD" },
  { key: "res", label: "RES" },
  { key: "behavior", label: "行为", full: true }, // 行为只展示在详情卡
];

function buildArtBox(id, size = 64) {
  // M2.14 美术到位后,这里改为: art ? img : 占位 SVG
  // 当前用 1px 边 + ID 前两字符的纯 CSS 占位
  const box = el("div", { class: "Codex-Item-Art" });
  box.style.background = `linear-gradient(135deg, var(--night-deep), var(--night-elev))`;
  box.style.position = "relative";
  const label = el("span", {
    style: {
      position: "absolute", inset: "0",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-pixel)", fontSize: "var(--fs-10)",
      color: "var(--fg-faint)", letterSpacing: "1px",
    },
  }, id.slice(0, 2).toUpperCase());
  box.append(label);
  return box;
}

function buildItemCard(item, kind) {
  const isUnlocked = state.unlocked[kind].has(item.id);
  const card = el("div", {
    class: "Codex-Item" + (isUnlocked ? "" : " is-locked"),
    dataset: { id: item.id, kind },
    role: "button",
    tabindex: "0",
    "aria-label": isUnlocked ? item.name : "未解锁",
  });

  card.append(buildArtBox(item.id));

  // 名称(锁状态由 CSS ::after 渲染 ??)
  card.append(el("div", { class: "Codex-Item-Name" }, isUnlocked ? item.name : "·"));

  // 6 属性缩略(只 5 项,行为不进卡片)
  if (isUnlocked) {
    const stats = el("div", { class: "Codex-Item-Stats" });
    for (const k of STAT_KEYS) {
      if (k.full) continue;
      const v = item[k.key];
      const isWarn = k.key === "hp" && v < 50;
      stats.append(el("div", { class: "Codex-Item-Stat" + (isWarn ? " is-warn" : "") }, [
        el("span", { class: "Codex-Item-Stat-Key" }, k.label),
        el("span", { class: "Codex-Item-Stat-Val" }, String(v)),
      ]));
    }
    card.append(stats);
  } else {
    // 锁状态只显示前 2 项模糊占位
    const stats = el("div", { class: "Codex-Item-Stats" });
    for (const k of STAT_KEYS.slice(0, 2)) {
      if (k.full) continue;
      stats.append(el("div", { class: "Codex-Item-Stat" }, [
        el("span", { class: "Codex-Item-Stat-Key" }, k.label),
        el("span", { class: "Codex-Item-Stat-Val" }, "??"),
      ]));
    }
    card.append(stats);
  }

  card.addEventListener("click", () => openDetail(item, kind));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(item, kind); }
  });
  return card;
}

function renderTabs() {
  const counts = {
    creatures: `${state.unlocked.creatures.size}/${CREATURES.length}`,
    items:     `${state.unlocked.items.size}/${ITEMS.length}`,
    recipes:   `${state.unlocked.recipes.size}/${(window.__wildwoodRecipes && window.__wildwoodRecipes.RECIPES) ? window.__wildwoodRecipes.RECIPES.length : 30}`,
  };
  els.tabs.innerHTML = "";
  for (const [k, label] of [["creatures", "生物"], ["items", "物品"], ["recipes", "食谱"]]) {
    const tab = el("button", {
      class: "Codex-Tab" + (state.tab === k ? " is-active" : ""),
      dataset: { tab: k },
    }, [
      label,
      el("span", { class: "Codex-Tab-Count" }, `[${counts[k]}]`),
    ]);
    tab.addEventListener("click", () => switchTab(k));
    els.tabs.append(tab);
  }
}

function renderList() {
  els.list.innerHTML = "";
  // v0.5.3 烹饪: 食谱 Tab 走专门渲染(双二级 Tab)
  if (state.tab === "recipes") {
    renderRecipesList();
    return;
  }
  const data = state.tab === "creatures" ? CREATURES : ITEMS;
  for (const item of data) {
    els.list.append(buildItemCard(item, state.tab));
  }
  // 给刚解锁的项加脉冲
  for (const id of state.justUnlocked) {
    const card = els.list.querySelector(`.Codex-Item[data-id="${id}"]`);
    if (card) {
      card.classList.add("is-just-unlocked");
      setTimeout(() => card.classList.remove("is-just-unlocked"), 1200);
    }
  }
}

// ============================================================================
// v0.5.3 烹饪 · 食谱图鉴(双二级 Tab: 分类 / 品质)
// 复用 M1.8 Dialog(详情卡) + M2.11 Codex 卡样式
// ============================================================================

const RECIPES_SUBTABS = [
  { id: "category", label: "按分类" },
  { id: "quality",  label: "按品质" }
];

const QUALITY_META = {
  1: { label: "普通", color: "#aaa",     short: "N" },
  2: { label: "优秀", color: "#d4a64a",  short: "E" },
  3: { label: "完美", color: "#c43a3a",  short: "P" }
};

const CATEGORY_META = {
  meat:    { label: "肉食", color: "#c43a3a" },
  fish:    { label: "鱼类", color: "#4a7a9a" },
  veg:     { label: "素食", color: "#4a8a4a" },
  sweet:   { label: "甜品", color: "#d4628a" },
  special: { label: "特殊", color: "#6a4a8a" }
};

function ingredientNameForCodex(id) {
  if (window.__wildwoodRecipes) {
    const ing = window.__wildwoodRecipes.getIngredient(id);
    if (ing) return ing.name;
  }
  // 兜底(items.json 已存在的)
  const map = { log:'木头', twine:'草绳', stone:'石头', flint:'燧石', iron_ore:'铁矿', dirt:'泥土', petals:'花瓣', ice:'冰',
              berries:'浆果', carrot:'胡萝卜', mushroom:'蘑菇' };
  return map[id] || id;
}

function renderRecipesList() {
  // 二级 Tab(分类 / 品质)
  const sub = el("div", { class: "Codex-Recipes-Sub" });
  for (const st of RECIPES_SUBTABS) {
    const t = el("button", {
      class: "Codex-Recipes-Sub-Tab" + (state.recipesSub === st.id ? " is-active" : ""),
      dataset: { sub: st.id }
    }, st.label);
    t.addEventListener("click", () => {
      state.recipesSub = st.id;
      renderRecipesList();
    });
    sub.append(t);
  }
  els.list.append(sub);

  const recipes = (window.__wildwoodRecipes && window.__wildwoodRecipes.RECIPES) || [];

  if (state.recipesSub === "category") {
    // 按分类分块
    for (const catId of Object.keys(CATEGORY_META)) {
      const block = recipes.filter(r => r.cat === catId);
      if (!block.length) continue;
      const head = el("div", { class: "Codex-Recipes-GroupHead" }, [
        el("span", { class: "Codex-Recipes-GroupLabel", style: { color: CATEGORY_META[catId].color } }, CATEGORY_META[catId].label),
        el("span", { class: "Codex-Recipes-GroupCount" }, `${block.filter(r => state.unlocked.recipes.has(r.id)).length}/${block.length}`),
      ]);
      els.list.append(head);
      const grid = el("div", { class: "Codex-Recipes-Grid" });
      for (const r of block) grid.append(buildRecipeCard(r));
      els.list.append(grid);
    }
  } else {
    // 按品质分块(3 档)
    for (const q of [1, 2, 3]) {
      const block = recipes.filter(r => r.quality === q);
      if (!block.length) continue;
      const head = el("div", { class: "Codex-Recipes-GroupHead" }, [
        el("span", { class: "Codex-Recipes-GroupLabel", style: { color: QUALITY_META[q].color } }, QUALITY_META[q].label + "品质"),
        el("span", { class: "Codex-Recipes-GroupCount" }, `${block.filter(r => state.unlocked.recipes.has(r.id)).length}/${block.length}`),
      ]);
      els.list.append(head);
      const grid = el("div", { class: "Codex-Recipes-Grid" });
      for (const r of block) grid.append(buildRecipeCard(r));
      els.list.append(grid);
    }
  }

  // 解锁脉冲
  for (const id of state.justUnlocked) {
    const card = els.list.querySelector(`.Codex-Item[data-id="${id}"]`);
    if (card) {
      card.classList.add("is-just-unlocked");
      setTimeout(() => card.classList.remove("is-just-unlocked"), 1200);
    }
  }
}

function buildRecipeCard(r) {
  const isUnlocked = state.unlocked.recipes.has(r.id);
  const q = QUALITY_META[r.quality];
  const cat = CATEGORY_META[r.cat];
  const card = el("div", {
    class: "Codex-Item Codex-Recipe" + (isUnlocked ? "" : " is-locked") + " Codex-Recipe-Q" + r.quality,
    dataset: { id: r.id, kind: "recipes" },
    role: "button",
    tabindex: "0",
    "aria-label": isUnlocked ? r.name : "未解锁"
  });

  // 64px 插画(用首字 + 分类色)
  const art = el("div", { class: "Codex-Item-Art" });
  art.append(el("span", {
    style: {
      position: "absolute", inset: "0",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-pixel)", fontSize: "var(--fs-18)",
      color: isUnlocked ? cat.color : "var(--fg-faint)", letterSpacing: "1px"
    }
  }, r.name.charAt(0)));
  card.append(art);

  // 名称
  card.append(el("div", { class: "Codex-Item-Name" }, isUnlocked ? r.name : "·"));

  // 4 食材缩写(锁: 灰显 + ?)
  if (isUnlocked) {
    const ingLine = el("div", { class: "Codex-Recipe-Ing" });
    r.ingredients.forEach((iid) => {
      ingLine.append(el("span", { class: "Codex-Recipe-Ing-Item" }, ingredientNameForCodex(iid).charAt(0)));
    });
    card.append(ingLine);
    // 品质标签
    card.append(el("div", { class: "Codex-Recipe-Quality" }, [
      el("span", { class: "Codex-Recipe-Quality-Icon", style: { color: q.color } }, q.short),
      el("span", { class: "Codex-Recipe-Quality-Label", style: { color: q.color } }, q.label),
    ]));
  } else {
    // 锁状态: 占位
    const ingLine = el("div", { class: "Codex-Recipe-Ing" });
    for (let k = 0; k < 4; k++) ingLine.append(el("span", { class: "Codex-Recipe-Ing-Item" }, "?"));
    card.append(ingLine);
    card.append(el("div", { class: "Codex-Recipe-Quality" }, [
      el("span", { class: "Codex-Recipe-Quality-Icon" }, "?"),
      el("span", { class: "Codex-Recipe-Quality-Label" }, "??"),
    ]));
  }

  card.addEventListener("click", () => openDetail(r, "recipes"));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(r, "recipes"); }
  });
  return card;
}

function openRecipeDetail(r) {
  const isUnlocked = state.unlocked.recipes.has(r.id);
  const q = QUALITY_META[r.quality];
  const cat = CATEGORY_META[r.cat];

  if (els.overlay) closeDetail();

  const overlay = el("div", { class: "Dialog-Overlay" });
  const dialog = el("div", { class: "Dialog Codex-Recipe-Detail", role: "dialog", "aria-label": r.name });

  // Header: 64px 插画 + 名称 + 品质 + 分类
  const headerArt = el("div", { class: "Codex-Item-Art" });
  headerArt.append(el("span", {
    style: {
      position: "absolute", inset: "0",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-pixel)", fontSize: "var(--fs-24)",
      color: isUnlocked ? cat.color : "var(--fg-faint)", letterSpacing: "1px"
    }
  }, isUnlocked ? r.name.charAt(0) : "?"));
  const headerLeft = el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-8)" } }, [
    headerArt,
    el("div", {}, [
      el("div", { class: "Dialog-Title" }, isUnlocked ? r.name : "?? ?? ??"),
      isUnlocked
        ? el("div", { class: "Codex-Detail-Sci" }, `${cat.label} · 基础品质 ${q.label}`)
        : el("div", { class: "Codex-Detail-Sci" }, r.hint || "未解锁 · 烹饪对应食材后开放"),
    ]),
  ]);
  const closeBtn = el("button", { class: "Dialog-Close", "aria-label": "关闭" }, "×");
  closeBtn.addEventListener("click", closeDetail);
  const header = el("div", { class: "Dialog-Header" }, [headerLeft, closeBtn]);

  // Body
  const body = el("div", { class: "Dialog-Body" });
  if (isUnlocked) {
    // 食材需求
    const ingSec = el("div", { class: "Codex-Detail-Section" }, [
      el("div", { class: "Codex-Detail-Section-Title" }, "▸ 所需食材"),
      el("div", { class: "Codex-Recipe-Detail-Ing" },
        r.ingredients.map((iid) => el("span", { class: "Codex-Recipe-Ing-Item Codex-Recipe-Ing-Item-Detail" }, ingredientNameForCodex(iid)))
      ),
    ]);
    body.append(ingSec);
    // 数值表
    const stats = el("div", { class: "Codex-Detail-Stats" });
    const items = [
      { k: "饥", v: r.hunger },
      { k: "精", v: r.sanity },
      { k: "血", v: r.health },
      { k: "保", v: r.perishDays + " 天" },
    ];
    for (const it of items) {
      const isWarn = (it.k === "血" && (typeof it.v === "number" && it.v < 0)) ||
                     (it.k === "精" && (typeof it.v === "number" && it.v < 0));
      stats.append(el("div", { class: "Codex-Detail-Stat" + (isWarn ? " is-warn" : "") }, [
        el("span", { class: "Codex-Detail-Stat-Key" }, it.k),
        el("span", { class: "Codex-Detail-Stat-Val" }, String(it.v)),
      ]));
    }
    body.append(stats);
    // 烹饪说明
    body.append(el("div", { class: "Codex-Detail-Section" }, [
      el("div", { class: "Codex-Detail-Section-Title" }, "▸ 烹饪指南"),
      el("div", { class: "Codex-Detail-Section-Body" },
        `放入全部 4 种食材到烹饪锅,点击「开始烹饪」即可制作。基础品质 ${q.label},4 食材精准匹配时有概率升档为完美;缺料将降档或失败。`),
    ]));
  } else {
    body.append(el("div", { class: "Codex-Detail-Section-Body", style: { textAlign: "center", padding: "var(--sp-24)" } },
      r.hint || "该食谱尚未解锁。\n完成对应条件后,5Hz 同步将自动开放。"));
  }

  // Footer
  const closeBtn2 = el("button", { class: "Button Button-Secondary" }, "关闭");
  closeBtn2.addEventListener("click", closeDetail);
  const footer = el("div", { class: "Dialog-Footer" }, [closeBtn2]);

  dialog.append(header, body, footer);
  overlay.addEventListener("click", closeDetail);
  document.body.append(overlay, dialog);

  els.overlay = overlay;
  els.dialog = dialog;
  document.addEventListener("keydown", onDetailKey);
}

function switchTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  renderTabs();
  renderList();
}

// ============================================================================
// 详情卡(复用 M1.8 Dialog)
// ============================================================================

function openDetail(item, kind) {
  // v0.5.3 烹饪: 食谱走专门详情卡(用 openRecipeDetail)
  if (kind === "recipes") { openRecipeDetail(item); return; }
  state.currentDetail = { id: item.id, kind };
  // 关闭已有
  if (els.overlay) closeDetail();

  const isUnlocked = state.unlocked[kind].has(item.id);

  // 复用 .Dialog / .Dialog-Overlay / .Dialog-Header / .Dialog-Body / .Dialog-Footer
  const overlay = el("div", { class: "Dialog-Overlay" });
  const dialog = el("div", { class: "Dialog", role: "dialog", "aria-label": item.name });

  // Header: 64px 插画 + 名称 + 学名
  const headerLeft = el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-8)" } }, [
    buildArtBox(item.id),
    el("div", {}, [
      el("div", { class: "Dialog-Title" }, isUnlocked ? item.name : "?? ?? ??"),
      isUnlocked
        ? el("div", { class: "Codex-Detail-Sci" }, item.sci)
        : el("div", { class: "Codex-Detail-Sci" }, "未解锁 · 击杀/采集后开放"),
    ]),
  ]);
  const closeBtn = el("button", { class: "Dialog-Close", "aria-label": "关闭" }, "×");
  closeBtn.addEventListener("click", closeDetail);
  const header = el("div", { class: "Dialog-Header" }, [headerLeft, closeBtn]);

  // Body: 6 属性 + 行为 + 克制
  const body = el("div", { class: "Dialog-Body" });
  if (isUnlocked) {
    // 6 属性(网格)
    const stats = el("div", { class: "Codex-Detail-Stats" });
    for (const k of STAT_KEYS) {
      if (k.full) continue;
      const v = item[k.key];
      const isWarn = k.key === "hp" && v < 50;
      stats.append(el("div", { class: "Codex-Detail-Stat" + (isWarn ? " is-warn" : "") }, [
        el("span", { class: "Codex-Detail-Stat-Key" }, k.label),
        el("span", { class: "Codex-Detail-Stat-Val" }, String(v)),
      ]));
    }
    body.append(stats);
    // 行为模式
    body.append(el("div", { class: "Codex-Detail-Section" }, [
      el("div", { class: "Codex-Detail-Section-Title" }, "▸ 行为模式"),
      el("div", { class: "Codex-Detail-Section-Body" }, item.behavior),
    ]));
    // 克制方法
    body.append(el("div", { class: "Codex-Detail-Section" }, [
      el("div", { class: "Codex-Detail-Section-Title" }, "▸ 克制方法"),
      el("div", { class: "Codex-Detail-Section-Body" }, item.counter),
    ]));
  } else {
    body.append(el("div", { class: "Codex-Detail-Section-Body", style: { textAlign: "center", padding: "var(--sp-24)" } },
      "该条目尚未解锁。\n击杀/采集对应实体后,5Hz 同步将自动开放。"));
  }

  // Footer: 关闭按钮(复用 .Button-Secondary)
  const closeBtn2 = el("button", { class: "Button Button-Secondary" }, "关闭");
  closeBtn2.addEventListener("click", closeDetail);
  const footer = el("div", { class: "Dialog-Footer" }, [closeBtn2]);

  dialog.append(header, body, footer);
  overlay.addEventListener("click", closeDetail);
  document.body.append(overlay, dialog);

  els.overlay = overlay;
  els.dialog = dialog;

  // ESC 关闭
  document.addEventListener("keydown", onDetailKey);
}

function onDetailKey(e) {
  if (e.key === "Escape") closeDetail();
}

function closeDetail() {
  if (els.overlay) { els.overlay.remove(); els.overlay = null; }
  if (els.dialog)  { els.dialog.remove();  els.dialog = null; }
  document.removeEventListener("keydown", onDetailKey);
  state.currentDetail = null;
}

// ============================================================================
// 5Hz 解锁广播
// ============================================================================

function showToast(text) {
  const old = document.querySelector(".Codex-Toast");
  if (old) old.remove();
  const t = el("div", { class: "Codex-Toast" }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 1500);
}

function unlockOne(id, kind) {
  if (state.unlocked[kind].has(id)) return;
  state.unlocked[kind].add(id);
  state.justUnlocked.add(id);
  // 5Hz 广播命中 → 渲染层刷新
  renderTabs();
  renderList();
  // toast
  let item = null;
  if (kind === "creatures") item = CREATURES.find((x) => x.id === id);
  else if (kind === "items") item = ITEMS.find((x) => x.id === id);
  else if (kind === "recipes" && window.__wildwoodRecipes) item = window.__wildwoodRecipes.RECIPES.find((x) => x.id === id);
  if (item) showToast(`✦ 新解锁 · ${item.name}`);
  setTimeout(() => state.justUnlocked.delete(id), 1300);
}

/** 接收广播:挑一个未解锁的 id 解锁(creatures / items / recipes 三类随机) */
function onBroadcast() {
  const kinds = ["creatures", "items"];
  if (window.__wildwoodRecipes && window.__wildwoodRecipes.RECIPES) kinds.push("recipes");
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  let pool = [];
  if (kind === "creatures") pool = CREATURES;
  else if (kind === "items") pool = ITEMS;
  else if (kind === "recipes" && window.__wildwoodRecipes) pool = window.__wildwoodRecipes.RECIPES;
  const locked = pool.filter((x) => !state.unlocked[kind].has(x.id));
  if (locked.length === 0) return;
  const target = locked[Math.floor(Math.random() * locked.length)];
  unlockOne(target.id, kind);
}

/** tick 心跳指示 */
const tickDot = { el: null, on: false };
function flashTick() {
  if (!tickDot.el) return;
  tickDot.on = !tickDot.on;
  tickDot.el.classList.toggle("is-on", tickDot.on);
}

// ============================================================================
// 初始化
// ============================================================================

export function initCodex(mountPoint) {
  // DOM 模板
  mountPoint.innerHTML = `
    <div class="Codex">
      <div class="Codex-Header">
        <button class="Codex-Back" data-act="back">◀ 返回游戏</button>
        <span>图鉴 · CODEX</span>
        <div class="Codex-Tick">
          <span>5Hz 同步</span>
          <span class="Codex-Tick-Dot"></span>
          <span data-bind="tick-count">0</span>
        </div>
      </div>
      <div class="Codex-Tabs" data-bind="tabs"></div>
      <div class="Codex-List" data-bind="list"></div>
      <div class="Codex-Demo-Controls">
        <span style="line-height:24px">演示控制(模拟击杀/采集):</span>
        <button class="Codex-Demo-Btn" data-act="unlock-random">随机解锁</button>
        <button class="Codex-Demo-Btn" data-act="unlock-all">一键全解锁</button>
        <button class="Codex-Demo-Btn" data-act="reset">重置</button>
      </div>
    </div>
  `;

  // 引用 DOM
  els.root    = mountPoint.querySelector(".Codex");
  els.tabs    = mountPoint.querySelector('[data-bind="tabs"]');
  els.list    = mountPoint.querySelector('[data-bind="list"]');
  els.tickEl  = mountPoint.querySelector('[data-bind="tick-count"]');
  tickDot.el  = mountPoint.querySelector(".Codex-Tick-Dot");

  // 返回按钮
  mountPoint.querySelector('[data-act="back"]').addEventListener("click", () => {
    if (typeof window.__wildwoodExitCodex === "function") window.__wildwoodExitCodex();
  });

  // 演示控制
  mountPoint.querySelector('[data-act="unlock-random"]').addEventListener("click", onBroadcast);
  mountPoint.querySelector('[data-act="unlock-all"]').addEventListener("click", () => {
    for (const x of CREATURES) state.unlocked.creatures.add(x.id);
    for (const x of ITEMS) state.unlocked.items.add(x.id);
    if (window.__wildwoodRecipes && window.__wildwoodRecipes.RECIPES) {
      for (const x of window.__wildwoodRecipes.RECIPES) state.unlocked.recipes.add(x.id);
    }
    renderTabs(); renderList();
    showToast("✦ 全部条目已解锁");
  });
  mountPoint.querySelector('[data-act="reset"]').addEventListener("click", () => {
    state.unlocked.creatures = new Set(INIT_UNLOCKED.creatures);
    state.unlocked.items = new Set(INIT_UNLOCKED.items);
    state.unlocked.recipes = new Set(INIT_UNLOCKED.recipes);
    if (window.__wildwoodRecipes && window.__wildwoodRecipes.INIT_UNLOCKED) {
      for (const id of window.__wildwoodRecipes.INIT_UNLOCKED) state.unlocked.recipes.add(id);
    }
    renderTabs(); renderList();
  });

  // 5Hz 订阅
  bus.subscribe("tick", () => {
    if (els.tickEl) els.tickEl.textContent = String(bus.tickCount);
    flashTick();
  });
  bus.subscribe("broadcast:unlock", onBroadcast);

  // 启动心跳(mock)
  bus.startMockBroadcast(6); // 每 6 tick = 1.2s 一次广播

  // 首渲
  renderTabs();
  renderList();
}

export function exitCodex() {
  bus.stop();
  closeDetail();
}
