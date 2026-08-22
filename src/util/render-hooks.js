/**
 * render-hooks.js — 模块级钩子,被 render 顶层 HUD 调用。
 *
 * 动机:BossBar / EventBanner 的 draw 函数闭包依赖 bossMgr / eventMgr 实例,
 * 这些实例在 assembleGame() 内部创建。为避免 render() 在调用时找不到引用,
 * 把 draw 函数注册到模块级钩子上,render 从钩子拿。
 *
 * 用法:
 *   assembly.js (装配层):
 *     import { setBossBarDraw, setEventBannerDraw } from './util/render-hooks.js';
 *     setBossBarDraw((dt) => bossBar.draw(bossMgr, canvas.width));
 *
 *   runtime.js (渲染层):
 *     import { getBossBarDraw, getEventBannerDraw } from './util/render-hooks.js';
 *     // 顶层 HUD: getBossBarDraw()(dt);
 */
'use strict';
let _bossBarDraw    = (_dt) => {};
let _eventBannerDraw = (_dt) => {};
export function setBossBarDraw(fn)    { _bossBarDraw = fn; }
export function setEventBannerDraw(fn) { _eventBannerDraw = fn; }
export function getBossBarDraw()    { return _bossBarDraw; }
export function getEventBannerDraw() { return _eventBannerDraw; }
