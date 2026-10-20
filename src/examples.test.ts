// The owner's example weeks, checked against hand-written reference rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLES, FAIR_EXAMPLES, applyChange } from "./examples.js";
import { reference } from "./reference.js";

for (const [rule, examples] of Object.entries(EXAMPLES) as [keyof typeof EXAMPLES, (typeof EXAMPLES)[keyof typeof EXAMPLES]][]) {
  test(`${rule}: owner's verdicts match the reference`, () => {
    for (const ex of examples) assert.equal(reference[rule](applyChange(ex.change)), ex.verdict === "fine", `${rule}/${ex.id}`);
  });
  test(`${rule}: the normal week keeps every rule`, () => {
    for (const [name, ok] of Object.entries(reference)) assert.ok(ok(applyChange({})), name);
  });
}

test("a fairness example's history override reaches the week", () => {
  const ex = FAIR_EXAMPLES.find((e) => e.id === "bad-chloe-again");
  assert.ok(ex);
  assert.equal(applyChange(ex.change).weekendHistory?.["chloe"], 8);
  assert.equal(applyChange({}).weekendHistory?.["chloe"], 3);
});
