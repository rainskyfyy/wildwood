"use strict";

/**
 * Rules registry. Each entry must export a standard ESLint rule object
 * (meta + create).
 */
module.exports = {
  // v0.7.0c: enforces the fixture-stability contract from
  // docs/spawner-fixture-guideline.md section 2 ("反模式: 绝对禁止").
  "no-find-then-index": require("./no-find-then-index"),
};
