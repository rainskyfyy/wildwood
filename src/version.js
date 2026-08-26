/**
 * Wildwood · 版本常量
 *
 * 统一版本号来源。任何需要在 UI / 菜单 / HUD 显示版本号的地方,
 * 从这里 import,避免各处硬编码(v0.4 / v0.8.18 等)失步。
 * 轻量、纯 ESM、无 npm 依赖,不与其他 agent 冲突。
 *
 * 用法:
 *   import { VERSION } from '../version.js';
 *   title(`Wildwood · v${VERSION}`);
 */
'use strict';

/** 当前游戏版本(主版本.次版本.修订)。发布时在此递增。 */
export const VERSION = '0.8.18';

/** 展示用前缀(如 "v0.8.18")。需要带 v 前缀时用 `${VERSION_PREFIX}${VERSION}`。 */
export const VERSION_PREFIX = 'v';
