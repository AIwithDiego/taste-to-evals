import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, screen } from "./sandbox.js";
import { baseWeek } from "./ollies.js";

test("refuses code that reaches outside the week", () => {
  assert.ok(screen('export function check(r: any) { return require("fs") }').length > 0);
  assert.ok(screen("export function check(r: any) { return process.env }").length > 0);
  assert.ok(screen("export function check(r: any) { return [].constructor.constructor('x') }").length > 0);
});

test("runs a plain check and gets violations back", async () => {
  const check = await compile(
    'export function check(rota: { shifts: { staffId: string }[] }) { return rota.shifts.length > 1 ? [{ message: "too many" }] : [] }',
  );
  assert.deepEqual(check(baseWeek()), [{ message: "too many" }]);
});

test("stops a check that never finishes", async () => {
  const check = await compile("export function check(r: unknown) { for (;;) {} }");
  assert.throws(() => check(baseWeek()));
});
