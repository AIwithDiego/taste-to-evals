// The chatbot checks Claude wrote at setup, on promises with a known answer, and the delivery guard.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claims } from "./domain.js";
import { loadChatChecks } from "./gate.js";
import { loadShop } from "./shop.js";

const none: Claims = { safeFor: [], discounts: [], bookings: [] };
const shop = loadShop();

async function broken(claims: Claims): Promise<string[]> {
  return (await loadChatChecks()).filter((c) => c.run({ claims, shop }).length).map((c) => c.id);
}

test("a reply that promises nothing breaks nothing", async () => {
  assert.deepEqual(await broken(none), []);
});

test("banana bread can't be promised safe for nuts; porridge can", async () => {
  assert.deepEqual(await broken({ ...none, safeFor: [{ item: "banana-bread", allergen: "nuts" }] }), ["allergens"]);
  assert.deepEqual(await broken({ ...none, safeFor: [{ item: "porridge", allergen: "nuts" }] }), []);
  assert.deepEqual(await broken({ ...none, safeFor: [{ item: "carrot-cake", allergen: "gluten" }] }), ["allergens"]);
});

test("any discount is stopped", async () => {
  assert.deepEqual(await broken({ ...none, discounts: [{ what: "a free coffee" }] }), ["discounts"]);
});

test("bookings: up to 8, 7am to 7pm, both limits allowed", async () => {
  assert.deepEqual(await broken({ ...none, bookings: [{ partySize: 8, day: "Friday", time: "19:00" }] }), []);
  assert.deepEqual(await broken({ ...none, bookings: [{ partySize: 2, day: "Monday", time: "07:00" }] }), []);
  assert.deepEqual(await broken({ ...none, bookings: [{ partySize: 10, day: "Saturday", time: "19:30" }] }), ["bookings"]);
  assert.deepEqual(await broken({ ...none, bookings: [{ partySize: 9, day: "Saturday", time: "12:00" }] }), ["bookings"]);
  assert.deepEqual(await broken({ ...none, bookings: [{ partySize: 4, day: "Saturday", time: "19:01" }] }), ["bookings"]);
});

test("deliver refuses a reply whose last try failed, and re-checks a passing one", async () => {
  process.env["SHIFTGUARD_DB"] = ":memory:";
  const { deliver } = await import("../store.js");
  const failed = await deliver("t1", "hi", [{ reply: "booked for 10", claims: none, passed: false, broken: ["x"] }], shop);
  assert.equal(failed.ok, false);
  const lied = await deliver("t1", "hi", [{ reply: "booked for 10", claims: { ...none, bookings: [{ partySize: 10, day: "Sat", time: "19:30" }] }, passed: true, broken: [] }], shop);
  assert.equal(lied.ok, false);
  const fine = await deliver("t1", "hi", [{ reply: "Hello", claims: none, passed: true, broken: [] }], shop);
  assert.equal(fine.ok, true);
});
