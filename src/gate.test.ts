import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLES, applyChange } from "./examples.js";
import { runChecks } from "./gate.js";

test("the normal week passes every check", async () => {
  const results = await runChecks(applyChange({}));
  assert.deepEqual(results.filter((r) => r.violations.length).map((r) => r.ruleId), []);
  assert.equal(results.length, 5);
});

test("every bad example week is stopped by its own rule", async () => {
  for (const [rule, examples] of Object.entries(EXAMPLES)) {
    for (const ex of examples.filter((e) => e.verdict === "not fine")) {
      const results = await runChecks(applyChange(ex.change));
      assert.ok(results.find((r) => r.ruleId === rule)?.violations.length, `${rule}/${ex.id}`);
    }
  }
});
