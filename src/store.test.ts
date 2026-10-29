// Approve is the only write, and it refuses anything that broke a rule.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLES, applyChange } from "./examples.js";
import { runChecks } from "./gate.js";

process.env["SHIFTGUARD_DB"] = ":memory:";
const { approve, approvedCount, recordProposal } = await import("./store.js");

test("a failing proposal can't be approved", async () => {
  const bad = EXAMPLES.hours.find((e) => e.verdict === "not fine");
  assert.ok(bad);
  const rota = applyChange(bad.change);
  const results = await runChecks(rota);
  const id = recordProposal({ request: "test", round: 1, note: "", rota, gate: { passed: false, results } });
  const before = approvedCount();
  const r = await approve(id, "Gráinne");
  assert.equal(r.ok, false);
  assert.equal(approvedCount(), before);
});

test("a proposal stored as passed is re-checked at approval, not trusted", async () => {
  const bad = EXAMPLES.rest.find((e) => e.verdict === "not fine");
  assert.ok(bad);
  const rota = applyChange(bad.change);
  const id = recordProposal({ request: "tampered", round: 1, note: "", rota, gate: { passed: true, results: [] } });
  const r = await approve(id, "Gráinne");
  assert.equal(r.ok, false);
});

test("a passing proposal is approved once; approving again writes nothing new", async () => {
  const rota = applyChange({});
  const results = await runChecks(rota);
  const id = recordProposal({ request: "test", round: 1, note: "", rota, gate: { passed: true, results } });
  const first = await approve(id, "Gráinne");
  const count = approvedCount();
  const second = await approve(id, "Gráinne");
  assert.ok(first.ok && !first.already);
  assert.ok(second.ok && second.already);
  assert.equal(approvedCount(), count);
});
