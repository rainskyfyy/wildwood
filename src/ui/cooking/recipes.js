/* Wildwood UI · v0.5.3 烹饪系统
 * 数据契约: 30 食谱 = { id, name, ingredients[4], priority, category, quality, unlockHint }
 *
 * 与 M2.11 风格一致: 字段顺序固定, 数值字段直接读, 锁状态由 unlocked 集合控制
 *
 * 30 食谱 × 5 分类(肉/鱼/素/甜/特殊) × 3 品质(普通/优秀/完美)
 * 初始解锁 10 道(覆盖 4 分类), 锁 20 道(灰剪影)
 *
 * 食材 ID 复用 src/resources/items.json 已定义的:
 *   log / twine / stone / flint / iron_ore / dirt / petals / ice
 *   berries / carrot / mushroom
 *   + 本模块扩展的 v0.5.3 烹饪食材(8 作物 / 3 肉 / 2 鱼)
 */

(function () {
  'use strict';

  // ============================================================================
  // 食材清单(扩展 items.json · v0.5.3 烹饪食材)
  // ============================================================================
  const INGREDIENTS = {
    // --- 复用 items.json ---
    berries:    { id: 'berries',    name: '浆果',    category: 'sweet' },
    carrot:     { id: 'carrot',     name: '胡萝卜',  category: 'veg' },
    mushroom:   { id: 'mushroom',   name: '蘑菇',    category: 'veg' },
    ice:        { id: 'ice',        name: '冰',      category: 'sweet' },
    // --- v0.5.3 新增(高级开发工程师 v0.5.3 子任务产出) ---
    meat:       { id: 'meat',       name: '生肉',    category: 'meat' },
    cooked_meat:{ id: 'cooked_meat',name: '烤肉',    category: 'meat' },
    fish:       { id: 'fish',       name: '鱼',      category: 'fish' },
    cooked_fish:{ id: 'cooked_fish',name: '熟鱼',    category: 'fish' },
    monster_meat:{id: 'monster_meat',name:'怪物肉',  category: 'meat' },
    drumstick:  { id: 'drumstick',  name: '鸡腿',    category: 'meat' },
    potato:     { id: 'potato',     name: '土豆',    category: 'veg' },
    tomato:     { id: 'tomato',     name: '番茄',    category: 'veg' },
    corn:       { id: 'corn',       name: '玉米',    category: 'veg' },
    pumpkin:    { id: 'pumpkin',    name: '南瓜',    category: 'veg' },
    watermelon: { id: 'watermelon', name: '西瓜',    category: 'sweet' },
    wheat:      { id: 'wheat',      name: '小麦',    category: 'veg' },
    honey:      { id: 'honey',      name: '蜂蜜',    category: 'sweet' },
    egg:        { id: 'egg',        name: '蛋',      category: 'dairy' },
    butter:     { id: 'butter',     name: '黄油',    category: 'dairy' },
    salt:       { id: 'salt',       name: '盐',      category: 'spice' },
    pepper:     { id: 'pepper',     name: '胡椒',    category: 'spice' },
    sugar:      { id: 'sugar',      name: '糖',      category: 'spice' },
    spice_herb: { id: 'spice_herb', name: '香草',    category: 'spice' }
  };

  // ============================================================================
  // 30 食谱
  // 字段: id / name / cat(分类) / ingredients(1-4 食材) / quality(基础品质) /
  //       hunger / sanity / health / perishDays / unlock(初始解锁?) / hint(锁提示)
  // ============================================================================
  // category: meat / fish / veg / sweet / special
  // quality:  1=普通 2=优秀 3=完美(基础品质,实际产出上下浮动一档)
  const RECIPES = [
    // ---------- 初始解锁(10) ----------
    { id: 'r_meatballs',    name: '肉丸',     cat: 'meat',   ingredients: ['meat', 'berries', 'ice', 'twine'],        quality: 1, hunger: 62.5, sanity: 5,  health: 3,   perishDays: 15, unlock: true,  hint: '' },
    { id: 'r_meat_skewer',  name: '烤肉串',   cat: 'meat',   ingredients: ['cooked_meat', 'carrot', 'pepper', 'twine'],quality: 2, hunger: 25,   sanity: 5,  health: 3,   perishDays: 10, unlock: true,  hint: '' },
    { id: 'r_fishsticks',   name: '炸鱼条',   cat: 'fish',   ingredients: ['fish', 'corn', 'flint', 'twine'],        quality: 1, hunger: 37.5, sanity: 10, health: 1,   perishDays: 10, unlock: true,  hint: '' },
    { id: 'r_fish_pie',     name: '鱼肉派',   cat: 'fish',   ingredients: ['cooked_fish', 'wheat', 'egg', 'butter'], quality: 2, hunger: 50,   sanity: 15, health: 8,   perishDays: 6,  unlock: true,  hint: '' },
    { id: 'r_vegetable_soup', name: '蔬菜汤', cat: 'veg',    ingredients: ['carrot', 'potato', 'mushroom', 'salt'],   quality: 1, hunger: 25,   sanity: 10, health: 20,  perishDays: 6,  unlock: true,  hint: '' },
    { id: 'r_pumpkin_soup', name: '南瓜浓汤', cat: 'veg',    ingredients: ['pumpkin', 'ice', 'butter', 'spice_herb'],quality: 2, hunger: 37.5, sanity: 20, health: 12,  perishDays: 4,  unlock: true,  hint: '' },
    { id: 'r_fruit_medley', name: '水果拼盘', cat: 'sweet',  ingredients: ['berries', 'watermelon', 'honey', 'ice'], quality: 1, hunger: 12.5, sanity: 20, health: 4,   perishDays: 3,  unlock: true,  hint: '' },
    { id: 'r_honey_nuggets',name: '蜜汁小食', cat: 'sweet',  ingredients: ['honey', 'wheat', 'egg', 'butter'],      quality: 2, hunger: 25,   sanity: 25, health: 3,   perishDays: 8,  unlock: true,  hint: '' },
    { id: 'r_ice_cream',    name: '冰淇淋',   cat: 'sweet',  ingredients: ['ice', 'honey', 'drumstick', 'salt'],     quality: 2, hunger: 25,   sanity: 30, health: -3,  perishDays: 3,  unlock: true,  hint: '' },
    { id: 'r_monster_tart', name: '怪物塔',   cat: 'special',ingredients: ['monster_meat', 'egg', 'flint', 'salt'],  quality: 2, hunger: 50,   sanity: -10,health: 20,  perishDays: 8,  unlock: true,  hint: '' },

    // ---------- 锁定(20)· 按分类排 ----------
    // 肉(3)
    { id: 'r_big_meal',     name: '豪华大餐', cat: 'meat',   ingredients: ['meat', 'drumstick', 'potato', 'spice_herb'], quality: 3, hunger: 75, sanity: 15, health: 12, perishDays: 12, unlock: false, hint: '解锁条件: 在烹饪锅完成 10 次烹饪' },
    { id: 'r_bacon_eggs',   name: '培根蛋',   cat: 'meat',   ingredients: ['meat', 'egg', 'butter', 'pepper'],       quality: 2, hunger: 50,   sanity: 10, health: 8,  perishDays: 6,  unlock: false, hint: '解锁条件: 击杀猪人获得培根' },
    { id: 'r_jerky',        name: '肉干',     cat: 'meat',   ingredients: ['meat', 'salt', 'pepper', 'twine'],       quality: 2, hunger: 25,   sanity: 5,  health: 0,  perishDays: 30, unlock: false, hint: '解锁条件: 建造晒肉架' },
    // 鱼(3)
    { id: 'r_fish_chips',   name: '炸鱼薯条', cat: 'fish',   ingredients: ['fish', 'potato', 'flint', 'salt'],        quality: 2, hunger: 50,   sanity: 15, health: 3,  perishDays: 8,  unlock: false, hint: '解锁条件: 钓鱼竿制作完成' },
    { id: 'r_sushi',        name: '寿司',     cat: 'fish',   ingredients: ['fish', 'seaweed', 'ice', 'rice'],        quality: 3, hunger: 37.5, sanity: 20, health: 4,  perishDays: 4,  unlock: false, hint: '解锁条件: 探索海岸群系' },
    { id: 'r_fish_curry',   name: '咖喱鱼',   cat: 'fish',   ingredients: ['fish', 'pepper', 'butter', 'spice_herb'], quality: 2, hunger: 50,   sanity: 10, health: 8,  perishDays: 6,  unlock: false, hint: '解锁条件: 探索沙漠群系' },
    // 素(4)
    { id: 'r_stuffed_eggplant', name: '酿茄子',cat: 'veg',   ingredients: ['eggplant', 'tomato', 'cheese', 'spice_herb'], quality: 3, hunger: 50, sanity: 20, health: 20, perishDays: 6, unlock: false, hint: '解锁条件: 群系森林采集茄子' },
    { id: 'r_ratatouille',  name: '普罗旺斯杂烩', cat: 'veg', ingredients: ['tomato', 'eggplant', 'zucchini', 'spice_herb'],quality: 3, hunger: 37.5, sanity: 25, health: 15, perishDays: 6, unlock: false, hint: '解锁条件: 完成种植 v0.5.3 全部 8 作物' },
    { id: 'r_potato_pancake', name: '土豆饼', cat: 'veg',   ingredients: ['potato', 'egg', 'butter', 'pepper'],     quality: 2, hunger: 37.5, sanity: 10, health: 5,  perishDays: 4,  unlock: false, hint: '解锁条件: 农场种植土豆成熟' },
    { id: 'r_corn_soup',    name: '玉米浓汤', cat: 'veg',    ingredients: ['corn', 'butter', 'salt', 'milk'],       quality: 1, hunger: 25,   sanity: 10, health: 4,  perishDays: 4,  unlock: false, hint: '解锁条件: 农场种植玉米成熟' },
    // 甜(4)
    { id: 'r_pumpkin_pie',  name: '南瓜派',   cat: 'sweet',  ingredients: ['pumpkin', 'wheat', 'sugar', 'egg'],       quality: 3, hunger: 50,   sanity: 25, health: 8,  perishDays: 6,  unlock: false, hint: '解锁条件: 击杀秋季 Boss 熊獾' },
    { id: 'r_waffles',      name: '华夫饼',   cat: 'sweet',  ingredients: ['wheat', 'egg', 'butter', 'sugar'],       quality: 2, hunger: 37.5, sanity: 20, health: 4,  perishDays: 5,  unlock: false, hint: '解锁条件: 烹饪锅完成 5 次甜品' },
    { id: 'r_jam',          name: '果酱',     cat: 'sweet',  ingredients: ['berries', 'sugar', 'twine', 'ice'],       quality: 1, hunger: 12.5, sanity: 15, health: 3,  perishDays: 20, unlock: false, hint: '解锁条件: 建造发酵桶' },
    { id: 'r_cake',         name: '蛋糕',     cat: 'sweet',  ingredients: ['wheat', 'egg', 'butter', 'honey'],       quality: 3, hunger: 75,   sanity: 35, health: 5,  perishDays: 6,  unlock: false, hint: '解锁条件: 完成 20 次甜品烹饪' },
    // 特殊(6) — Boss / 季节限定
    { id: 'r_dragon_pie',   name: '龙鳞派',   cat: 'special',ingredients: ['dragon_fruit', 'wheat', 'butter', 'sugar'], quality: 3, hunger: 100, sanity: 40, health: 30, perishDays: 8, unlock: false, hint: '解锁条件: 击杀冬季 Boss 冰龙' },
    { id: 'r_ant_meal',     name: '蚁后蜜露糕', cat: 'special', ingredients: ['ant_honey', 'wheat', 'butter', 'sugar'], quality: 3, hunger: 100, sanity: 30, health: 25, perishDays: 10, unlock: false, hint: '解锁条件: 击杀夏季 Boss 蚁后' },
    { id: 'r_deer_steak',   name: '鹿肉排',   cat: 'special',ingredients: ['deer_meat', 'pepper', 'butter', 'spice_herb'], quality: 3, hunger: 100, sanity: 20, health: 20, perishDays: 8, unlock: false, hint: '解锁条件: 击杀春季 Boss 巨鹿' },
    { id: 'r_bear_burger',  name: '熊肉汉堡', cat: 'special',ingredients: ['bear_meat', 'wheat', 'tomato', 'lettuce'], quality: 3, hunger: 100, sanity: 25, health: 20, perishDays: 6, unlock: false, hint: '解锁条件: 击杀秋季 Boss 熊獾' },
    { id: 'r_survival_burger', name: '荒野汉堡', cat: 'special', ingredients: ['meat', 'wheat', 'tomato', 'cheese'], quality: 2, hunger: 75, sanity: 15, health: 12, perishDays: 8, unlock: false, hint: '解锁条件: 累计击杀 50 只怪物' },
    { id: 'r_pot_porridge', name: '末日糊糊', cat: 'special',ingredients: ['monster_meat', 'twigs', 'ice', 'dirt'],   quality: 1, hunger: 25,   sanity: -20,health: -10,perishDays: 20, unlock: false, hint: '解锁条件: 故意把不能吃的东西扔进锅' }
  ];

  // 5 分类标签(用于图鉴分类 Tab)
  const CATEGORIES = [
    { id: 'meat',    label: '肉食', icon: 'M' },
    { id: 'fish',    label: '鱼类', icon: 'F' },
    { id: 'veg',     label: '素食', icon: 'V' },
    { id: 'sweet',   label: '甜品', icon: 'S' },
    { id: 'special', label: '特殊', icon: 'X' }
  ];

  // 3 品质(用于图鉴品质 Tab)
  const QUALITIES = [
    { id: 1, label: '普通', color: '#aaa',     short: 'N' },
    { id: 2, label: '优秀', color: '#d4a64a',  short: 'E' },
    { id: 3, label: '完美', color: '#c43a3a',  short: 'P' }
  ];

  // ============================================================================
  // 初始解锁集合
  // ============================================================================
  const INIT_UNLOCKED = new Set(RECIPES.filter(r => r.unlock).map(r => r.id));

  // ============================================================================
  // 暴露给 M2.11 Codex + cooking.js
  // ============================================================================
  const api = {
    INGREDIENTS: Object.freeze(INGREDIENTS),
    RECIPES:     Object.freeze(RECIPES.map(r => Object.freeze(Object.assign({}, r)))),
    CATEGORIES:  Object.freeze(CATEGORIES),
    QUALITIES:   Object.freeze(QUALITIES),
    INIT_UNLOCKED: new Set(INIT_UNLOCKED),

    getIngredient(id) { return INGREDIENTS[id] || null; },

    getRecipe(id) { return RECIPES.find(r => r.id === id) || null; },

    /** 模糊匹配: 给定一组食材(去重), 返回所有可制作的食谱
     *  - exact: 食谱全部食材都在 pot 中存在
     *  - 否则 partial: 至少 1 食材 overlap, 返回 ratio 和 missing
     *  - 排序: exact 优先 → ratio 降序 → 食谱 id
     */
    matchRecipes(ingredients) {
      const have = new Set(ingredients.filter(Boolean));
      if (have.size === 0) return [];
      const matches = [];
      for (const r of RECIPES) {
        const reqSet = new Set(r.ingredients);
        const exactMatch = r.ingredients.every(x => have.has(x));
        const overlap = r.ingredients.filter(x => have.has(x)).length;
        if (exactMatch) {
          matches.push({ recipe: r, exact: true, ratio: 1, missing: [] });
        } else if (overlap > 0) {
          const missing = r.ingredients.filter(x => !have.has(x));
          matches.push({ recipe: r, exact: false, ratio: overlap / r.ingredients.length, missing });
        }
      }
      matches.sort((a, b) => {
        if (a.exact !== b.exact) return a.exact ? -1 : 1;
        if (a.ratio !== b.ratio) return b.ratio - a.ratio;
        return a.recipe.id.localeCompare(b.recipe.id);
      });
      return matches;
    },

    /** 计算最终品质
     *  - exact match + 0 overflow → 倾向完美
     *  - 缺 1 食材 → 基准
     *  - 缺 2+ 食材 → 不可烹饪
     *  - 其他情况 30% 概率升档
     */
    rollQuality(recipe, ingredients) {
      const have = new Set(ingredients.filter(Boolean));
      const exact = recipe.ingredients.every(x => have.has(x));
      const overflow = ingredients.filter(x => x && !recipe.ingredients.includes(x)).length;
      let roll = recipe.quality;
      if (exact && overflow === 0) roll = Math.min(3, recipe.quality + 1);
      else if (!exact) roll = Math.max(1, recipe.quality - 1);
      if (!(exact && overflow === 0) && Math.random() < 0.3 && roll < 3) roll += 1;
      return Math.max(1, Math.min(3, roll));
    }
  };

  if (typeof window !== 'undefined') {
    window.__wildwoodRecipes = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
