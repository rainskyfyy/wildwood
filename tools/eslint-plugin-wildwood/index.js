"use strict";

/**
 * eslint-plugin-wildwood
 * -----------------------
 * Wildwood-specific ESLint rules. The headline rule is `no-find-then-index`,
 * which enforces the test-fixture stability contract documented in
 * docs/spawner-fixture-guideline.md.
 *
 * Motivation: spawner output order is not stable across catalog changes
 * (see M2.10c incident). Tests that locate a specific entity by
 * `arr.find(pred)[0]` or `arr.find(pred)[N]` silently pick the wrong
 * element the moment the catalog gains or loses an entry. This rule
 * fails the lint on that pattern so the regression cannot ship.
 *
 * Adding new rules: implement in rules/<rule-name>.js, then register
 * in rules/index.js. The plugin exposes them all by id
 * `wildwood/<rule-name>`.
 */

const rules = require("./rules");

module.exports = {
  meta: {
    name: "eslint-plugin-wildwood",
    version: "0.1.0",
  },
  rules,
};
