# Wildwood 音效资源（assets/audio）

> v0.4 音效系统说明 / 资源占位 / 后续替换指南

## 当前状态（v0.4）

**v0.4 默认使用 Web Audio API 程序合成** —— 无需任何外部音频文件即可
跑通全功能。所有 SFX、UI 提示、生物群系环境音都通过 `src/audio/synth/`
下的噪声发生器 + 双二阶滤波器 + ADSR 包络 + LFO 调制实时合成。

合成实现位于：
- `src/audio/synth/noise.js` — 白噪声 / 粉噪声（Voss-McCartney）/ 棕噪声
- `src/audio/synth/envelope.js` — ADSR / 线性 ramp
- `src/audio/synth/filter.js` — BiquadFilter / LFO / 失真曲线
- `src/audio/synth/recipe.js` — 16 种 SFX 配方 + 5 种群系 ambient

## 资源目录（建议）

```
assets/audio/
├── ambient/
│   ├── desert.ogg     # 沙漠 — 风声 / 沙粒滚动
│   ├── marsh.ogg      # 沼泽 — 蛙鸣 / 水声
│   ├── snow.ogg       # 雪山 — 风声 / 寒冷静谧
│   ├── volcano.ogg    # 熔岩 — 低频嗡鸣 / 岩浆
│   ├── forest.ogg     # 森林 — 鸟鸣 / 树叶沙沙
│   ├── plains.ogg     # 平原 — 草原风
│   └── mines.ogg      # 矿洞 — 滴水 / 回声
├── sfx/
│   ├── gather-1.ogg
│   ├── gather-2.ogg
│   ├── gather-3.ogg
│   ├── build_place.ogg
│   ├── build_fail.ogg
│   ├── build_remove.ogg
│   ├── attack.ogg
│   ├── hurt.ogg
│   ├── death.ogg
│   ├── craft.ogg
│   ├── pickup.ogg
│   └── footstep.ogg
└── ui/
    ├── click.ogg
    ├── hover.ogg
    ├── open.ogg
    ├── close.ogg
    └── error.ogg
```

## 素材来源（CC0 / CC-BY 推荐）

1. **freesound.org** — 最大的免费音效库，搜索时筛选 `CC0` 许可
2. **opengameart.org** — 游戏专用，授权清晰
3. **kenney.nl** — UI 音效合集，统一风格
4. **incompetech.com** — BGM 资源（Kevin MacLeod 作品，CC-BY）
5. **zapsplat.com** — 免费分类音效（需注明来源）

## 切换为文件资源

打开 `src/audio/registry.js`，把对应 entry 改成：

```js
import { registerRecipe } from './registry.js';
registerRecipe('gather', {
  kind: 'file',
  src: './assets/audio/sfx/gather-1.ogg',
  volume: 0.8
});
```

`AudioManager.play(id)` 会自动检测 `kind`：
- `kind: 'recipe'` → 调用合成配方
- `kind: 'file'` → 用 `fetch(src)` + `decodeAudioData` 加载并播放

## 命名约定

文件名必须与 `DEFAULT_RECIPES` 中的 id 一致（或通过 `registerRecipe` 显式映射）：

| id             | 推荐搜索关键词                              |
|----------------|---------------------------------------------|
| `gather`       | chop wood, pick herb, break stone           |
| `build_place`  | place structure, wooden thud                 |
| `build_fail`   | error buzz, denied                          |
| `build_remove` | dismantle wood                              |
| `attack`       | sword slash, swoosh                         |
| `hurt`         | hit grunt, growl                            |
| `death`        | death thud, low rumble                      |
| `craft`        | bell chime, magical ding                    |
| `pickup`       | item pickup, soft pop                       |
| `footstep`     | grass step, soft thud                       |
| `ui_click`     | UI click, button press                      |
| `ui_hover`     | UI hover, soft tick                         |
| `ui_open`      | menu open, whoosh                           |
| `ui_close`     | menu close, soft click                      |
| `ui_error`     | error buzz, denied                          |

## Ambient 群系音

群系音建议 8~15 秒无缝循环，PCM 44.1 kHz / OGG Vorbis q5。
- `desert`  : 风沙、远方的嗡鸣、低 Q 噪声
- `marsh`   : 水泡、青蛙、偶尔的鸟
- `snow`    : 风声、冷空气
- `volcano` : 低频隆隆、岩浆噼啪
- `forest`  : 树叶、鸟鸣
- `plains`  : 草原风
- `mines`   : 滴水、远方的回声

## 占位 / 临时方案

在替换为真实素材前，v0.4 用合成声覆盖：
- 玩家 99% 不会感觉缺素材（合成音已经过 ADSR + LFO 调音）
- 适合作为 CI / 单元测试目标（不依赖网络下载）
- 切换到真实文件无需改任何调用方代码

## 音效的"理智扭曲"

`AudioManager.setSanityAmount(amount)` 实时改变 BGM 通道的低通截止
频率（22050 → 800 Hz），叠加 LFO 颤音，模拟 sanity 下降时的诡异感。
推荐把 BGM 资源也按此过滤曲线重新混合验证。
