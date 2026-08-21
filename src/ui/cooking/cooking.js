/**
 * Wildwood UI · v0.5.3 烹饪系统
 * - 烹饪锅 (Cooking Pot)  : 4 食材槽 + 1 成品槽 + 实时食谱预览 + 烹饪按钮 + 进度条 + 品质标签
 * - 晒肉架 (Drying Rack)  : 1 放入槽 + 进度条 + 1 取出槽
 * - 发酵桶 (Fermenter)    : 1 放入槽 + 进度条 + 1 取出槽
 *
 * 设计契约(与现有 UI 风格保持一致):
 *   - 复用 M1.8 Dialog 弹层 (Dialog / Dialog-Overlay / Dialog-Header / Dialog-Body / Dialog-Footer)
 *   - 复用 M2.13 拖拽 4 状态机 (IDLE / DRAGGING / MERGE / MOVE / REJECTED)
 *   - 5Hz 状态同步接入 window.__hudBus(M2.12)
 *   - 8/16px 网格 + 0/2px 圆角 + 像素字体标题
 *
 * API:
 *   window.__wildwoodCooking.openCookingPot()    -> 打开烹饪锅
 *   window.__wildwoodCooking.openDryingRack()   -> 打开晒肉架
 *   window.__wildwoodCooking.openFermenter()    -> 打开发酵桶
 *   window.__wildwoodCooking.closeAll()         -> 关闭全部
 *   window.__wildwoodCooking.cookRandomDemo()   -> 模拟一次烹饪(从背包随机取食材)
 *
 * 食材来源:
 *   烹饪锅 4 槽食材 通过拖拽放入, 数据来源:
 *     a) M2.13 state.inventory(state.inventory[i] = {itemId, count})
 *     b) 直接拖入 (任何 [data-cooking-ingredient="<id>"] 元素)
 *     c) 演示按钮"自动配菜"自动从 mock 库存取
 *   本模块不直接修改 state.inventory, 通过 hudBus 'cooking:cook' 事件通知 M2.13 扣减
 */

(function () {
  'use strict';

  // ============================================================================
  // 配置
  // ============================================================================
  var TICK_MS = 200;             // 5Hz, 与 M2.12 对齐
  var COOK_DURATION_MS = 2000;   // 烹饪 2s
  var DRY_DURATION_MS  = 3000;   // 晒制 3s
  var FERM_DURATION_MS = 4000;   // 发酵 4s
  var POT_SLOTS = 4;             // 烹饪锅 4 食材槽
  var POT_RESULT_SLOT = 1;       // 烹饪锅 1 成品槽

  // ============================================================================
  // 工具(沿用 screens.js / codex.js 的 el 工厂)
  // ============================================================================
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (dk) { node.dataset[dk] = v[dk]; });
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    if (children) {
      [].concat(children).forEach(function (c) {
        if (c == null) return;
        node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return node;
  }

  // 食材 ID 的视觉缩写(无美术资源,用首字)
  function ingredientShortName(id) {
    var ing = (window.__wildwoodRecipes && window.__wildwoodRecipes.getIngredient(id)) || null;
    if (ing) return ing.name.charAt(0);
    // 复用 items.json 的
    var map = { log:'木', twine:'绳', stone:'石', flint:'燧', iron_ore:'铁', dirt:'土', petals:'瓣', ice:'冰',
                berries:'果', carrot:'萝', mushroom:'菇' };
    return map[id] || (id || '?').charAt(0).toUpperCase();
  }

  function ingredientName(id) {
    var ing = (window.__wildwoodRecipes && window.__wildwoodRecipes.getIngredient(id));
    if (ing) return ing.name;
    var map = { log:'木头', twine:'草绳', stone:'石头', flint:'燧石', iron_ore:'铁矿', dirt:'泥土', petals:'花瓣', ice:'冰',
                berries:'浆果', carrot:'胡萝卜', mushroom:'蘑菇' };
    return map[id] || id;
  }

  // 食材分类对应的颜色(品质预览)
  function categoryColor(cat) {
    switch (cat) {
      case 'meat':  return '#c43a3a';
      case 'fish':  return '#4a7a9a';
      case 'veg':   return '#4a8a4a';
      case 'sweet': return '#d4628a';
      case 'dairy': return '#e8d4a8';
      case 'spice': return '#b8862a';
      default:      return 'var(--fg-muted)';
    }
  }

  // 品质文字+颜色
  var QUALITY = {
    1: { label: '普通', color: '#aaa',     icon: '○' },
    2: { label: '优秀', color: '#d4a64a',  icon: '◐' },
    3: { label: '完美', color: '#c43a3a',  icon: '●' }
  };

  // ============================================================================
  // 食材槽(支持拖入, 复用 M2.13 拖拽 4 状态语义)
  // ============================================================================
  // slot: { idx, ingredientId (null/empty), element, onChange }
  function buildIngredientSlot(idx, onChange, size) {
    size = size || 56;
    var slot = el('div', {
      class: 'PotSlot is-empty',
      dataset: { slot: 'ingredient', idx: String(idx) },
      'aria-label': '食材槽 ' + (idx + 1)
    });
    slot.style.width  = size + 'px';
    slot.style.height = size + 'px';

    var label = el('span', { class: 'PotSlot-Index' }, String(idx + 1));
    slot.appendChild(label);
    var art = el('div', { class: 'PotSlot-Art' });
    slot.appendChild(art);

    // 拖入支持(接受任何带 [data-cooking-ingredient] 或来自 inventory 槽的 drag)
    slot.addEventListener('dragover', function (e) {
      if (slotHasData(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        slot.classList.add('DragMove');
      }
    });
    slot.addEventListener('dragleave', function () { slot.classList.remove('DragMove', 'DragReject'); });
    slot.addEventListener('drop', function (e) {
      e.preventDefault();
      slot.classList.remove('DragMove', 'DragReject');
      var data = parseDragData(e);
      if (!data) {
        slot.classList.add('DragReject');
        setTimeout(function () { slot.classList.remove('DragReject'); }, 220);
        return;
      }
      // 设置食材(替换或置入)
      var prev = slot.dataset.ingredient || null;
      slot.dataset.ingredient = data.itemId;
      slot.classList.remove('is-empty');
      slot.classList.add('is-filled');
      slot.querySelector('.PotSlot-Art').textContent = ingredientShortName(data.itemId);
      slot.querySelector('.PotSlot-Art').style.color = ingredientColor(data.itemId);
      // 移除 label 数字(让位给 art)
      if (label.parentNode) label.style.display = 'none';
      // 触发 onChange(prev, next)
      onChange(idx, prev, data.itemId);
    });

    // 点击已放置食材 → 移除
    slot.addEventListener('click', function () {
      if (!slot.dataset.ingredient) return;
      var prev = slot.dataset.ingredient;
      delete slot.dataset.ingredient;
      slot.classList.add('is-empty');
      slot.classList.remove('is-filled');
      slot.querySelector('.PotSlot-Art').textContent = '';
      if (label.parentNode) label.style.display = '';
      onChange(idx, prev, null);
    });

    return slot;
  }

  function slotHasData(e) {
    if (!e.dataTransfer) return false;
    var types = e.dataTransfer.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, 'text/plain') >= 0 ||
           Array.prototype.indexOf.call(types, 'application/x-cooking-ingredient') >= 0;
  }

  function parseDragData(e) {
    try {
      var raw = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('application/x-cooking-ingredient');
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data.itemId) return null;
      return data;
    } catch (err) { return null; }
  }

  function ingredientColor(id) {
    var ing = (window.__wildwoodRecipes && window.__wildwoodRecipes.getIngredient(id));
    if (ing) return categoryColor(ing.category);
    var map = {
      log: '#8a5a2a', twine: '#5a8a3a', stone: '#7a7070', flint: '#3a3a3a',
      iron_ore: '#a85a3a', dirt: '#7a5a3a', petals: '#d4628a', ice: '#a8d4e8',
      berries: '#8a2a4a', carrot: '#d4802a', mushroom: '#b8704a'
    };
    return map[id] || 'var(--accent)';
  }

  // ============================================================================
  // 烹饪锅 (Cooking Pot)
  // ============================================================================
  var potState = null;     // { ingredients: [4], cooking: bool, result: {recipe, quality} }

  function openCookingPot() {
    if (potState) return;  // 已打开
    potState = {
      ingredients: [null, null, null, null],
      selectedRecipe: null,   // 用户点选的食谱(模糊匹配列表中选中的)
      cooking: false,
      progress: 0,
      result: null
    };

    var dialog = buildCookingPotDialog();
    document.body.appendChild(dialog.overlay);
    document.body.appendChild(dialog.root);

    // ESC 关闭
    var onKey = function (e) {
      if (e.key === 'Escape') { closeCookingPot(); }
    };
    document.addEventListener('keydown', onKey);
    dialog._onKey = onKey;
  }

  function buildCookingPotDialog() {
    var overlay = el('div', { class: 'Dialog-Overlay PotOverlay' });
    var dialog  = el('div', { class: 'Dialog PotDialog', role: 'dialog', 'aria-label': '烹饪锅' });

    // --- Header ---
    var closeBtn = el('button', { class: 'Dialog-Close', 'aria-label': '关闭' }, '×');
    closeBtn.addEventListener('click', closeCookingPot);
    var header = el('div', { class: 'Dialog-Header' }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-8)' } }, [
        el('span', { class: 'PotHeader-Icon' }, '◇'),
        el('span', { class: 'Dialog-Title' }, '烹饪锅 · COOKING POT')
      ]),
      closeBtn
    ]);

    // --- Body ---
    var body = el('div', { class: 'Dialog-Body PotBody' });

    // 左: 锅体(4 食材槽 + 1 成品槽)
    var potArea = el('div', { class: 'PotArea' });

    // 锅体背景视觉(同心圆 + 火苗 emoji 替代)
    var potVisual = el('div', { class: 'PotVisual' });
    potVisual.appendChild(el('div', { class: 'PotVisual-Ring' }, ''));
    potVisual.appendChild(el('div', { class: 'PotVisual-Fire' }, '♨'));
    potArea.appendChild(potVisual);

    // 4 食材槽(环绕锅体)
    var slotRing = el('div', { class: 'PotSlotRing' });
    var slotEls = [];
    for (var i = 0; i < POT_SLOTS; i++) {
      (function (idx) {
        var s = buildIngredientSlot(idx, function (slotIdx, prev, next) {
          potState.ingredients[slotIdx] = next;
          updatePreview();
          if (potState.cooking) return; // 烹饪中不改
          // 切换食材后清掉 result
          potState.result = null;
          potState.selectedRecipe = null;
          updateResultSlot();
          updateCookButton();
        });
        slotEls.push(s);
        slotRing.appendChild(s);
      })(i);
    }
    potArea.appendChild(slotRing);

    // 烹饪按钮 + 进度条(锅体下方)
    var cookBtn = el('button', { class: 'Button Button-Primary PotCookBtn', 'aria-label': '开始烹饪' }, '▷ 开始烹饪');
    var cookBar = el('div', { class: 'PotCookBar' });
    var cookBarFill = el('div', { class: 'PotCookBar-Fill' });
    var cookBarText = el('span', { class: 'PotCookBar-Text' }, '');
    cookBar.appendChild(cookBarFill);
    cookBar.appendChild(cookBarText);
    cookBtn.addEventListener('click', function () { startCooking(); });

    var potFooter = el('div', { class: 'PotFooter' }, [cookBtn, cookBar]);
    potArea.appendChild(potFooter);

    // 右: 成品槽(垂直放右侧,带品质标签)
    var resultSlot = el('div', { class: 'PotResultSlot' });
    resultSlot.appendChild(el('div', { class: 'PotResultSlot-Label' }, '成品 · RESULT'));
    var resultBox = el('div', { class: 'PotResultBox is-empty', 'aria-label': '成品槽' });
    resultBox.appendChild(el('div', { class: 'PotResultBox-Art' }, '?'));
    resultBox.appendChild(el('div', { class: 'PotResultBox-Name' }, '等待烹饪'));
    var qualityTag = el('div', { class: 'PotQualityTag' });
    qualityTag.style.display = 'none';
    resultBox.appendChild(qualityTag);
    resultSlot.appendChild(resultBox);
    resultSlot.appendChild(el('div', { class: 'PotResultSlot-Hint' }, '放入 4 种食材后自动预览食谱'));

    // 中: 实时预览(垂直放中间,食谱列表)
    var previewPanel = el('div', { class: 'PotPreview' });
    previewPanel.appendChild(el('div', { class: 'PotPreview-Title' }, '▸ 实时预览 · MATCHES'));
    var previewList = el('div', { class: 'PotPreview-List' });
    previewPanel.appendChild(previewList);

    // 组装 body: 3 列布局
    var layout = el('div', { class: 'PotLayout' }, [potArea, previewPanel, resultSlot]);
    body.appendChild(layout);

    // --- Footer ---
    var clearBtn = el('button', { class: 'Button Button-Secondary' }, '清空锅');
    clearBtn.addEventListener('click', function () {
      if (potState.cooking) return;
      clearPot();
    });
    var demoBtn = el('button', { class: 'Button Button-Secondary' }, '自动配菜');
    demoBtn.addEventListener('click', function () {
      if (potState.cooking) return;
      autoFillDemo();
    });
    var footer = el('div', { class: 'Dialog-Footer' }, [
      demoBtn, clearBtn,
      el('button', { class: 'Button Button-Danger' }, '关闭'),
    ]);
    footer.children[2].addEventListener('click', closeCookingPot);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.addEventListener('click', closeCookingPot);

    // 暴露给内部更新函数
    potState._dom = {
      overlay: overlay, dialog: dialog,
      slotEls: slotEls,
      previewList: previewList,
      resultBox: resultBox,
      qualityTag: qualityTag,
      cookBtn: cookBtn,
      cookBar: cookBar,
      cookBarFill: cookBarFill,
      cookBarText: cookBarText
    };

    return { overlay: overlay, root: dialog };
  }

  // 实时预览: 根据当前 ingredients 调 matchRecipes, 渲染列表
  function updatePreview() {
    if (!potState) return;
    var list = potState._dom.previewList;
    list.innerHTML = '';

    var matches = window.__wildwoodRecipes.matchRecipes(potState.ingredients);
    if (matches.length === 0) {
      list.appendChild(el('div', { class: 'PotPreview-Empty' }, '· 放入食材开始匹配 ·'));
      return;
    }

    for (var i = 0; i < matches.length; i++) {
      (function (m, idx) {
        var card = el('div', {
          class: 'PotPreview-Card' + (m.exact ? ' is-exact' : ' is-partial') +
                 (potState.selectedRecipe === m.recipe ? ' is-selected' : ''),
          dataset: { recipeId: m.recipe.id }
        });
        // 头部: 名称 + 标签
        var head = el('div', { class: 'PotPreview-Card-Head' });
        head.appendChild(el('span', { class: 'PotPreview-Card-Name' }, m.recipe.name));
        head.appendChild(el('span', { class: 'PotPreview-Card-Cat PotPreview-Card-Cat-' + m.recipe.cat }, m.recipe.cat));
        var q = QUALITY[m.recipe.quality];
        head.appendChild(el('span', { class: 'PotPreview-Card-Quality' }, [
          el('span', { style: { color: q.color } }, q.icon),
          ' ' + q.label
        ]));
        card.appendChild(head);
        // 食材需求
        var reqLine = el('div', { class: 'PotPreview-Card-Req' });
        m.recipe.ingredients.forEach(function (ing) {
          var have = potState.ingredients.indexOf(ing) >= 0;
          var tag = el('span', { class: 'PotPreview-Ing' + (have ? ' is-have' : ' is-miss') }, [
            el('span', { class: 'PotPreview-Ing-Mark' }, have ? '✓' : '×'),
            ' ' + ingredientName(ing)
          ]);
          reqLine.appendChild(tag);
        });
        card.appendChild(reqLine);
        // 缺料提示(partial)
        if (!m.exact) {
          card.appendChild(el('div', { class: 'PotPreview-Card-Missing' },
            '缺: ' + m.missing.map(ingredientName).join(' / ')));
        }
        // 数值预览
        var stats = el('div', { class: 'PotPreview-Card-Stats' });
        stats.appendChild(el('span', {}, '饥 ' + m.recipe.hunger));
        stats.appendChild(el('span', {}, '·  ' + m.recipe.sanity + '精神'));
        stats.appendChild(el('span', {}, '·  ' + m.recipe.health + '血'));
        stats.appendChild(el('span', {}, '·  ' + m.recipe.perishDays + '天'));
        card.appendChild(stats);

        // 选中(只在 exact 时有效, partial 不可烹饪)
        if (m.exact) {
          card.addEventListener('click', function () {
            potState.selectedRecipe = m.recipe;
            updatePreview();
            updateResultSlot();
            updateCookButton();
          });
        } else {
          card.classList.add('is-disabled');
        }
        list.appendChild(card);
      })(matches[i], i);
    }
  }

  function updateResultSlot() {
    if (!potState) return;
    var box = potState._dom.resultBox;
    var tag = potState._dom.qualityTag;
    box.classList.remove('is-empty', 'is-filled', 'is-cooking');
    if (potState.cooking) {
      box.classList.add('is-cooking');
      box.querySelector('.PotResultBox-Art').textContent = '♨';
      box.querySelector('.PotResultBox-Name').textContent = '烹饪中…';
      tag.style.display = 'none';
      return;
    }
    if (potState.result) {
      box.classList.add('is-filled');
      var r = potState.result;
      box.querySelector('.PotResultBox-Art').textContent = r.recipe.name.charAt(0);
      box.querySelector('.PotResultBox-Name').textContent = r.recipe.name;
      var q = QUALITY[r.quality];
      tag.style.display = '';
      tag.className = 'PotQualityTag PotQualityTag-' + r.quality;
      tag.innerHTML = '';
      tag.appendChild(el('span', { class: 'PotQualityTag-Icon', style: { color: q.color } }, q.icon));
      tag.appendChild(el('span', { class: 'PotQualityTag-Label', style: { color: q.color } }, q.label));
    } else {
      box.classList.add('is-empty');
      box.querySelector('.PotResultBox-Art').textContent = '?';
      box.querySelector('.PotResultBox-Name').textContent = '等待烹饪';
      tag.style.display = 'none';
    }
  }

  function updateCookButton() {
    if (!potState) return;
    var btn = potState._dom.cookBtn;
    if (potState.cooking) {
      btn.setAttribute('disabled', '');
      btn.classList.add('Button-Disabled');
      return;
    }
    if (potState.selectedRecipe) {
      btn.removeAttribute('disabled');
      btn.classList.remove('Button-Disabled');
    } else {
      btn.setAttribute('disabled', '');
      btn.classList.add('Button-Disabled');
    }
  }

  function clearPot() {
    if (!potState || potState.cooking) return;
    potState.ingredients = [null, null, null, null];
    potState.selectedRecipe = null;
    potState.result = null;
    potState._dom.slotEls.forEach(function (s) {
      delete s.dataset.ingredient;
      s.classList.add('is-empty');
      s.classList.remove('is-filled');
      s.querySelector('.PotSlot-Art').textContent = '';
      var lbl = s.querySelector('.PotSlot-Index');
      if (lbl) lbl.style.display = '';
    });
    updatePreview();
    updateResultSlot();
    updateCookButton();
  }

  function autoFillDemo() {
    if (!potState || potState.cooking) return;
    // 优先用 M2.13 inventory 的 items, 否则用 recipes.js 的 demo pool
    var pool = ['meat', 'carrot', 'mushroom', 'berries', 'fish', 'pumpkin', 'honey', 'egg', 'butter', 'potato', 'ice', 'pepper', 'salt', 'spice_herb', 'drumstick', 'cooked_meat', 'cooked_fish', 'monster_meat', 'watermelon', 'wheat', 'corn', 'tomato'];
    // 随机选 4 个不重复的
    var pick = [];
    var used = {};
    while (pick.length < 4) {
      var idx = Math.floor(Math.random() * pool.length);
      if (used[idx]) continue;
      used[idx] = true;
      pick.push(pool[idx]);
    }
    for (var i = 0; i < 4; i++) {
      potState.ingredients[i] = pick[i];
      var s = potState._dom.slotEls[i];
      s.dataset.ingredient = pick[i];
      s.classList.add('is-filled');
      s.classList.remove('is-empty');
      s.querySelector('.PotSlot-Art').textContent = ingredientShortName(pick[i]);
      s.querySelector('.PotSlot-Art').style.color = ingredientColor(pick[i]);
      var lbl = s.querySelector('.PotSlot-Index');
      if (lbl) lbl.style.display = 'none';
    }
    // 自动选第一条 exact match(若有)
    var matches = window.__wildwoodRecipes.matchRecipes(potState.ingredients);
    potState.selectedRecipe = (matches.find(function (m) { return m.exact; }) || {}).recipe || null;
    potState.result = null;
    updatePreview();
    updateResultSlot();
    updateCookButton();
  }

  function startCooking() {
    if (!potState || potState.cooking || !potState.selectedRecipe) return;
    potState.cooking = true;
    potState.progress = 0;
    potState.result = null;
    updateCookButton();
    updateResultSlot();

    var startTime = Date.now();
    var interval = setInterval(function () {
      var elapsed = Date.now() - startTime;
      potState.progress = Math.min(1, elapsed / COOK_DURATION_MS);
      potState._dom.cookBarFill.style.width = (potState.progress * 100) + '%';
      potState._dom.cookBarText.textContent = Math.floor(potState.progress * 100) + '%';
      if (potState.progress >= 1) {
        clearInterval(interval);
        finishCooking();
      }
    }, TICK_MS / 5); // 25Hz 平滑进度
  }

  function finishCooking() {
    if (!potState) return;
    // 计算品质
    var quality = window.__wildwoodRecipes.rollQuality(potState.selectedRecipe, potState.ingredients);
    potState.result = { recipe: potState.selectedRecipe, quality: quality };
    potState.cooking = false;
    potState.progress = 0;
    potState._dom.cookBarFill.style.width = '0%';
    potState._dom.cookBarText.textContent = '';
    updateCookButton();
    updateResultSlot();
    // 5Hz 广播
    if (window.__hudBus) {
      window.__hudBus.emit('cooking:complete', {
        recipeId: potState.selectedRecipe.id,
        quality: quality,
        timestamp: Date.now()
      });
    }
    // toast
    showToast('✦ 完成 · ' + potState.selectedRecipe.name + ' (' + QUALITY[quality].label + ')');
  }

  function closeCookingPot() {
    if (!potState) return;
    if (potState._dom && potState._dom.overlay) potState._dom.overlay.remove();
    if (potState._dom && potState._dom.dialog) potState._dom.dialog.remove();
    if (potState._dom && potState._dom._onKey) document.removeEventListener('keydown', potState._dom._onKey);
    potState = null;
  }

  // ============================================================================
  // 通用加工站(晒肉架 / 发酵桶) — 单槽进度型, 复用同套 UI
  // ============================================================================
  // state: { inputId, progress, resultId, working, duration, stationKind }
  var stationState = null;

  function openDryingRack() {
    openStation('drying', '晒肉架 · DRYING RACK', '放入生食材延长保质期', 3000, function (id) {
      // 晒肉架接受的食材
      var ok = ['meat', 'cooked_meat', 'fish', 'cooked_fish', 'monster_meat', 'drumstick'];
      return ok.indexOf(id) >= 0;
    }, function (id) {
      // 输出
      var map = {
        meat: 'jerky', cooked_meat: 'jerky', fish: 'dried_fish', cooked_fish: 'dried_fish',
        monster_meat: 'jerky', drumstick: 'jerky'
      };
      return map[id] || 'jerky';
    });
  }

  function openFermenter() {
    openStation('fermenter', '发酵桶 · FERMENTER', '酿造药水与果酱', 4000, function (id) {
      var ok = ['berries', 'honey', 'mushroom', 'ice', 'watermelon', 'pumpkin', 'tomato'];
      return ok.indexOf(id) >= 0;
    }, function (id) {
      var map = {
        berries: 'jam', honey: 'mead', mushroom: 'potion_health',
        ice: 'ice_pack', watermelon: 'watermelon_jam',
        pumpkin: 'pumpkin_wine', tomato: 'ketchup'
      };
      return map[id] || 'potion_mystery';
    });
  }

  function openStation(kind, title, hint, duration, accepts, transform) {
    if (stationState) return;
    stationState = {
      kind: kind, title: title, hint: hint,
      duration: duration, accepts: accepts, transform: transform,
      inputId: null, progress: 0, resultId: null, working: false
    };

    var overlay = el('div', { class: 'Dialog-Overlay StationOverlay' });
    var dialog  = el('div', { class: 'Dialog StationDialog', role: 'dialog', 'aria-label': title });

    var closeBtn = el('button', { class: 'Dialog-Close', 'aria-label': '关闭' }, '×');
    closeBtn.addEventListener('click', closeStation);

    var header = el('div', { class: 'Dialog-Header' }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-8)' } }, [
        el('span', { class: 'StationHeader-Icon' }, kind === 'drying' ? '⛛' : '◉'),
        el('span', { class: 'Dialog-Title' }, title)
      ]),
      closeBtn
    ]);

    var body = el('div', { class: 'Dialog-Body StationBody' });
    body.appendChild(el('div', { class: 'StationHint' }, hint));

    // 视觉: 横排 3 槽 [放入] → [加工中] → [取出]
    var flow = el('div', { class: 'StationFlow' });

    var inputSlot = buildIngredientSlot(0, function () {
      stationState.inputId = arguments[2] || null;
      // 校验
      if (stationState.inputId && !stationState.accepts(stationState.inputId)) {
        showToast('✗ 该食材不适合 ' + stationState.title);
        // 回退
        stationState.inputId = null;
        var s = stationState._dom.inputSlot;
        delete s.dataset.ingredient;
        s.classList.add('is-empty');
        s.classList.remove('is-filled');
        s.querySelector('.PotSlot-Art').textContent = '';
        var lbl = s.querySelector('.PotSlot-Index');
        if (lbl) lbl.style.display = '';
        return;
      }
      updateStationUI();
    });
    inputSlot.classList.add('StationInputSlot');

    var processBox = el('div', { class: 'StationProcess' });
    processBox.appendChild(el('div', { class: 'StationProcess-Icon' }, kind === 'drying' ? '☼' : '◐'));
    var processBar = el('div', { class: 'StationProcess-Bar' });
    var processBarFill = el('div', { class: 'StationProcess-Bar-Fill' });
    var processBarText = el('span', { class: 'StationProcess-Bar-Text' }, '');
    processBar.appendChild(processBarFill);
    processBar.appendChild(processBarText);
    processBox.appendChild(processBar);
    var startBtn = el('button', { class: 'Button Button-Primary' }, '▷ 开始' + (kind === 'drying' ? '晒制' : '发酵'));
    startBtn.addEventListener('click', function () { startStation(); });
    processBox.appendChild(startBtn);

    var outputSlot = el('div', { class: 'StationOutputSlot' });
    var outputBox = el('div', { class: 'PotResultBox is-empty' });
    outputBox.appendChild(el('div', { class: 'PotResultBox-Art' }, '?'));
    outputBox.appendChild(el('div', { class: 'PotResultBox-Name' }, '等待加工'));
    outputSlot.appendChild(outputBox);

    flow.appendChild(inputSlot);
    flow.appendChild(el('div', { class: 'StationArrow' }, '→'));
    flow.appendChild(processBox);
    flow.appendChild(el('div', { class: 'StationArrow' }, '→'));
    flow.appendChild(outputSlot);
    body.appendChild(flow);

    // 接受的食材提示
    var acceptList = el('div', { class: 'StationAcceptList' });
    acceptList.appendChild(el('span', { class: 'StationAcceptList-Label' }, '可放入:'));
    var ingIds = ['meat', 'cooked_meat', 'fish', 'cooked_fish', 'monster_meat', 'drumstick'];
    if (kind === 'fermenter') ingIds = ['berries', 'honey', 'mushroom', 'ice', 'watermelon', 'pumpkin', 'tomato'];
    ingIds.forEach(function (iid) {
      acceptList.appendChild(el('span', { class: 'StationAcceptList-Item' }, [
        el('span', { class: 'StationAcceptList-Art', style: { color: ingredientColor(iid) } }, ingredientShortName(iid)),
        ingredientName(iid)
      ]));
    });
    body.appendChild(acceptList);

    var footer = el('div', { class: 'Dialog-Footer' }, [
      el('button', { class: 'Button Button-Danger' }, '关闭')
    ]);
    footer.firstChild.addEventListener('click', closeStation);

    dialog.appendChild(header); dialog.appendChild(body); dialog.appendChild(footer);
    overlay.addEventListener('click', closeStation);
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    stationState._dom = {
      overlay: overlay, dialog: dialog,
      inputSlot: inputSlot, processBox: processBox, processBar: processBar,
      processBarFill: processBarFill, processBarText: processBarText,
      outputBox: outputBox, startBtn: startBtn
    };

    var onKey = function (e) { if (e.key === 'Escape') closeStation(); };
    document.addEventListener('keydown', onKey);
    stationState._dom._onKey = onKey;
  }

  function updateStationUI() {
    if (!stationState) return;
    var d = stationState._dom;
    if (stationState.working) {
      d.startBtn.setAttribute('disabled', '');
      d.startBtn.classList.add('Button-Disabled');
    } else {
      d.startBtn.removeAttribute('disabled');
      d.startBtn.classList.remove('Button-Disabled');
    }
    if (stationState.resultId) {
      d.outputBox.classList.remove('is-empty');
      d.outputBox.classList.add('is-filled');
      d.outputBox.querySelector('.PotResultBox-Art').textContent = ingredientShortName(stationState.resultId);
      d.outputBox.querySelector('.PotResultBox-Art').style.color = ingredientColor(stationState.resultId);
      d.outputBox.querySelector('.PotResultBox-Name').textContent = ingredientName(stationState.resultId);
    } else {
      d.outputBox.classList.add('is-empty');
      d.outputBox.classList.remove('is-filled');
      d.outputBox.querySelector('.PotResultBox-Art').textContent = '?';
      d.outputBox.querySelector('.PotResultBox-Name').textContent = '等待加工';
    }
  }

  function startStation() {
    if (!stationState || stationState.working || !stationState.inputId) return;
    stationState.working = true;
    stationState.progress = 0;
    stationState.resultId = null;
    updateStationUI();
    var startTime = Date.now();
    var interval = setInterval(function () {
      var elapsed = Date.now() - startTime;
      stationState.progress = Math.min(1, elapsed / stationState.duration);
      stationState._dom.processBarFill.style.width = (stationState.progress * 100) + '%';
      stationState._dom.processBarText.textContent = Math.floor(stationState.progress * 100) + '%';
      if (stationState.progress >= 1) {
        clearInterval(interval);
        stationState.resultId = stationState.transform(stationState.inputId);
        stationState.working = false;
        stationState.progress = 0;
        stationState.inputId = null;
        // 清空输入槽
        var s = stationState._dom.inputSlot;
        delete s.dataset.ingredient;
        s.classList.add('is-empty');
        s.classList.remove('is-filled');
        s.querySelector('.PotSlot-Art').textContent = '';
        var lbl = s.querySelector('.PotSlot-Index');
        if (lbl) lbl.style.display = '';
        stationState._dom.processBarFill.style.width = '0%';
        stationState._dom.processBarText.textContent = '';
        updateStationUI();
        if (window.__hudBus) {
          window.__hudBus.emit('cooking:station-complete', {
            station: stationState.kind,
            output: stationState.resultId,
            timestamp: Date.now()
          });
        }
        showToast('✦ 完成 · ' + ingredientName(stationState.resultId));
      }
    }, TICK_MS / 5);
  }

  function closeStation() {
    if (!stationState) return;
    if (stationState._dom && stationState._dom.overlay) stationState._dom.overlay.remove();
    if (stationState._dom && stationState._dom.dialog) stationState._dom.dialog.remove();
    if (stationState._dom && stationState._dom._onKey) document.removeEventListener('keydown', stationState._dom._onKey);
    stationState = null;
  }

  // ============================================================================
  // 通用: 提示 toast
  // ============================================================================
  function showToast(text) {
    var old = document.querySelector('.Cooking-Toast');
    if (old) old.remove();
    var t = el('div', { class: 'Cooking-Toast' }, text);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  // ============================================================================
  // 暴露 API
  // ============================================================================
  var api = {
    openCookingPot: openCookingPot,
    openDryingRack: openDryingRack,
    openFermenter: openFermenter,
    closeCookingPot: closeCookingPot,
    closeStation: closeStation,
    closeAll: function () { closeCookingPot(); closeStation(); },
    cookRandomDemo: function () {
      openCookingPot();
      setTimeout(autoFillDemo, 100);
    }
  };

  if (typeof window !== 'undefined') {
    window.__wildwoodCooking = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
