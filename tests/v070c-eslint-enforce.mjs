/**
 * v0.7.0c ESLint plugin self-test
 * --------------------------------
 * Runs ESLint's built-in RuleTester against `wildwood/no-find-then-index`
 * to prove the rule fires on the bad patterns and stays silent on the
 * correct ones. This is the unit test for the rule itself; in CI it
 * should run via `npm run lint:rule-test` (see package.json).
 *
 * If the rule regresses (silently allows a banned pattern or false-
 * positives a valid one), this file fails before any real code is
 * affected.
 */

import { RuleTester } from "eslint";
import rule from "../tools/eslint-plugin-wildwood/rules/no-find-then-index.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
  },
});

// ─── INVALID: each must report exactly one error ─────────────────────
ruleTester.run("wildwood/no-find-then-index", rule, {
  invalid: [
    {
      // Direct chained numeric literal index
      code: "const t = ents.find(e => e.id === 'tree')[0];",
      errors: [{ messageId: "directIndex" }],
    },
    {
      // Direct chained numeric literal index (non-zero)
      code: "const t = ents.find(e => e.id === 'rock')[3];",
      errors: [{ messageId: "directIndex" }],
    },
    {
      // Direct chained variable index
      code: "const t = ents.find(e => e.id === 'tree')[i];",
      errors: [{ messageId: "directIndex" }],
    },
    {
      // Stored then indexed
      code: [
        "const t = ents.find(e => e.id === 'tree');",
        "use(t[0]);",
      ].join("\n"),
      errors: [{ messageId: "storedIndex" }],
    },
    {
      // Stored then indexed (variable subscript)
      code: [
        "const t = ents.find(e => e.id === 'rock');",
        "use(t[i]);",
      ].join("\n"),
      errors: [{ messageId: "storedIndex" }],
    },
  ],

  // ─── VALID: no errors expected ────────────────────────────────────
  valid: [
    {
      // Correct: use findNearest
      code: "const t = findNearest(ents, px, py, 'tree');",
    },
    {
      // Correct: findInRange (inRange sorts by dist, so [0] is the nearest)
      code: "const t = findInRange(ents, px, py, 30, 'rock')[0];",
    },
    {
      // Correct: groupById
      code: "const trees = groupById(ents).tree;",
    },
    {
      // .find without indexed access — returns a single object, caller
      // may legitimately use it as long as it doesn't depend on order
      // semantics (this is informational; the rule is silent here).
      code: "const t = ents.find(e => e.id === 'tree');\nuse(t);",
    },
    {
      // Array literal indexed (not a find call)
      code: "const t = [1,2,3][0];",
    },
    {
      // Chained member access on find result (not an index) — allowed
      code: "const t = ents.find(e => e.id === 'tree').distTo(0, 0);",
    },
    {
      // Destructured find result
      code: "const { x, y } = ents.find(e => e.id === 'tree');",
    },
  ],
});

console.log("✓ wildwood/no-find-then-index: 5 invalid + 7 valid cases passed");
