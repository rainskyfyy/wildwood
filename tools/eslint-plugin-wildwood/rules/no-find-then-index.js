"use strict";

/**
 * Rule: no-find-then-index
 * ------------------------
 * Bans `arr.find(pred)[N]` and `const x = arr.find(pred); x[N]` patterns.
 *
 * Rationale: Wildwood's spawner output order is NOT stable across catalog
 * changes (see docs/spawner-fixture-guideline.md and the M2.10c incident).
 * `.find()` returns the first element matching the predicate in spawn
 * order, which is *not* the semantically intended entity (e.g. "the
 * nearest tree"). Using a numeric index on top of `.find()` compounds
 * the problem: the test now depends on both ordering assumptions.
 *
 * Allowed alternatives (all from src/resources/spawner.js, v0.6.0c+):
 *   - findNearest(ents, x, y, id?)
 *   - findInRange(ents, x, y, maxRadius, id?)
 *   - groupById(ents) ... .id.length
 *
 * Examples:
 *   // INVALID
 *   const t = ents.find(e => e.id === 'tree')[0];
 *   const t = ents.find(e => e.id === 'tree')[i];
 *
 *   const t = ents.find(e => e.id === 'tree');
 *   foo(t[0]);              // also invalid
 *
 *   // VALID
 *   const t = findNearest(ents, px, py, 'tree');
 *   const t = findInRange(ents, px, py, 30, 'tree')[0];   // OK: inRange sorts by dist
 *   const t = groupById(ents).tree[0];                    // OK: in spawner helper
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "禁止在 .find() 结果上用数字下标访问;spawner 输出顺序不稳定," +
        ".find 拿到的不是语义目标而是 spawn 顺序第一个命中",
      category: "Best Practices",
      recommended: true,
    },
    schema: [],
    messages: {
      directIndex:
        "禁止在 .find() 结果上直接用数字下标 ({{reason}})。" +
        "改用 spawner.js 的 findNearest / findInRange / groupById (v0.6.0c+)。",
      storedIndex:
        "禁止对 .find() 赋值的变量 ({{name}}) 用数字下标访问。" +
        "改用 spawner.js 的 findNearest / findInRange / groupById (v0.6.0c+)。",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    /**
     * Returns true iff node is a CallExpression that calls `.find(...)` on
     * some object (any depth is fine — `a.b.c.find(...)` still counts).
     */
    function isFindCall(node) {
      if (!node || node.type !== "CallExpression") return false;
      const callee = node.callee;
      return (
        callee.type === "MemberExpression" &&
        callee.property &&
        callee.property.type === "Identifier" &&
        callee.property.name === "find" &&
        callee.computed === false
      );
    }

    /**
     * Stringify the subscript for a useful error message. Numeric literals
     * get a special hint; variables get rendered source; anything else
     * falls back to a generic phrase.
     */
    function describeSubscript(subscriptNode) {
      if (
        subscriptNode.type === "Literal" &&
        typeof subscriptNode.value === "number"
      ) {
        return `硬下标 [${subscriptNode.value}]`;
      }
      if (subscriptNode.type === "Identifier") {
        return `变量下标 [${subscriptNode.name}]`;
      }
      return "动态下标";
    }

    return {
      // Pattern 1: arr.find(pred)[N] (direct chained access)
      MemberExpression(node) {
        if (!node.computed) return;
        if (!isFindCall(node.object)) return;
        context.report({
          node,
          messageId: "directIndex",
          data: { reason: describeSubscript(node.property) },
        });
      },

      // Pattern 2: const x = arr.find(pred); x[N]
      "VariableDeclarator:exit"(node) {
        if (!isFindCall(node.init)) return;
        if (node.id.type !== "Identifier") return; // skip destructuring

        const name = node.id.name;
        const scope = sourceCode.getScope(node);
        // Walk inner scopes (block scopes) looking for reads of `name`.
        const visited = new Set();
        const stack = [scope];
        while (stack.length) {
          const s = stack.pop();
          if (visited.has(s)) continue;
          visited.add(s);
          for (const ref of s.references) {
            if (ref.resolved !== s.set.get(name)) continue;
            const idNode = ref.identifier;
            // Skip the binding site itself (the `const x` declarator)
            if (
              idNode.parent === node ||
              (idNode.parent && idNode.parent.parent === node)
            ) {
              continue;
            }
            // Look at the parent expression: if it's a computed MemberExpression
            // on this identifier with a numeric-literal or identifier subscript,
            // report.
            const parent = idNode.parent;
            if (
              parent &&
              parent.type === "MemberExpression" &&
              parent.object === idNode &&
              parent.computed
            ) {
              context.report({
                node: parent,
                messageId: "storedIndex",
                data: { name },
              });
            }
          }
          for (const child of s.childScopes) stack.push(child);
        }
      },
    };
  },
};
