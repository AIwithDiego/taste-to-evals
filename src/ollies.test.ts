import assert from "node:assert/strict";
import { test } from "node:test";
import { shiftHours } from "./domain.js";
import { MAX_HOURS_EXAMPLES, applyChange } from "./examples.js";
import { baseWeek } from "./ollies.js";

function hoursByPerson(rota: ReturnType<typeof baseWeek>): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of rota.shifts) m.set(s.staffId, (m.get(s.staffId) ?? 0) + shiftHours(s));
  return m;
}

test("normal week: nobody over 40, Sarah/Tom/Liam on exactly 40", () => {
  const h = hoursByPerson(baseWeek());
  for (const [, hours] of h) assert.ok(hours <= 40);
  assert.equal(h.get("sarah"), 40);
  assert.equal(h.get("tom"), 40);
  assert.equal(h.get("liam"), 40);
});

test("normal week: no close followed by an open the next morning", () => {
  const rota = baseWeek();
  for (const c of rota.shifts.filter((s) => s.kind === "close")) {
    const next = new Date(`${c.date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    assert.ok(!rota.shifts.some((s) => s.staffId === c.staffId && s.date === nextDate && s.kind === "open"), c.id);
  }
});

test("normal week: a trained barista on every opening and closing team, Aoife off Tuesday", () => {
  const rota = baseWeek();
  const barista = new Set(rota.staff.filter((p) => p.trainedBarista).map((p) => p.id));
  const teams = new Map<string, string[]>();
  for (const s of rota.shifts.filter((x) => x.kind !== "mid")) {
    const k = `${s.date}-${s.kind}`;
    teams.set(k, [...(teams.get(k) ?? []), s.staffId]);
  }
  assert.equal(teams.size, 14);
  for (const [k, ids] of teams) {
    assert.equal(ids.length, 2, k);
    assert.ok(ids.some((id) => barista.has(id)), k);
  }
  assert.ok(!rota.shifts.some((s) => s.staffId === "aoife" && s.date === "2026-10-27"));
});

test("max-hours examples: owner's verdicts match the hours", () => {
  for (const ex of MAX_HOURS_EXAMPLES) {
    const over = [...hoursByPerson(applyChange(ex.change)).values()].some((h) => h > 40);
    assert.equal(over, ex.verdict === "not fine", ex.id);
  }
});
