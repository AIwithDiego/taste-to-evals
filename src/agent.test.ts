// The assistant can only read. These tests fail if anyone gives it a way to write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { READ_TOOLS } from "./agent.js";

test("every tool the assistant has only reads", () => {
  assert.ok(READ_TOOLS.length > 0);
  for (const t of READ_TOOLS) assert.match(t.name, /^read_/, t.name);
});

test("the assistant's code can't reach the store or the file system's write calls", () => {
  const source = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from "\.\/store\.js"/);
  assert.doesNotMatch(source, /node:sqlite|writeFile|appendFile|createWriteStream/);
});

test("the assistant isn't handed the owner's rules", () => {
  assert.ok(!READ_TOOLS.some((t) => t.name === "read_rules"));
});
