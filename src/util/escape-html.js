/**
 * escape-html.js — 单文件复用,避免 assembly.js <-> runtime.js 循环依赖。
 */
'use strict';
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
