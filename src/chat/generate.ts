// Turns a captured chatbot rule into a check, then proves it on Gráinne's example replies.
// The check reads the promises Claude found in a reply, never the wording, so the same reply always gets the same answer.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ask } from "../claude.js";
import type { Outcome } from "../generate.js";
import type { RuleSpec } from "../interview.js";
import { compile } from "../sandbox.js";
import { readClaims } from "./claims.js";
import type { Claims, ReplyFacts, Shop } from "./domain.js";
import type { ChatExample } from "./examples.js";

const ClaimsShape = z.object({
  safeFor: z.array(z.object({ item: z.string(), allergen: z.enum(["nuts", "peanuts", "gluten", "dairy", "egg", "soy", "sesame", "celery"]) })),
  discounts: z.array(z.object({ what: z.string() })),
  bookings: z.array(z.object({ partySize: z.number().int().nullable(), day: z.string().nullable(), time: z.string().nullable() })),
});

const Generated = z.object({
  code: z.string().describe("TypeScript source defining `export function check(input: ReplyFacts): Violation[]`"),
  howItWorks: z.string().describe("Two plain sentences a café owner would understand"),
  testCases: z
    .array(
      z.object({
        name: z.string(),
        short: z.string().describe("One line in the owner's voice, max 12 words, like: 'It books 9 people for Friday lunch.'"),
        why: z.string().describe("What edge this tests, in plain words"),
        claims: ClaimsShape,
        expect: z.enum(["pass", "fail"]),
      }),
    )
    .describe("Exactly two extra test replies, given as the promises they make, that probe the edges of the rule"),
});
export type ChatGenerated = z.infer<typeof Generated>;

const SYSTEM = `You write checks for ShiftGuard, which stops a café's website chatbot from sending a reply that breaks the owner's rules.
Claude has already read the draft reply and listed what it promises (input.claims). Your check decides, from those promises and the shop's facts (input.shop), whether the rule is kept:

  export function check(input: ReplyFacts): Violation[]

It returns [] when the reply keeps the rule, or one Violation per broken promise.

Hard limits (the code is screened and run in a sandbox; breaking these means it is refused):
- No imports, no require, no globals beyond plain JavaScript (Math, Number, String, Array, Object, Map, Set, JSON).
- Do not use the words: process, globalThis, global, eval, Function, fetch, constructor, prototype, __proto__, Reflect, Proxy, setTimeout, setInterval.
- Deterministic. Do not mutate the input. The types below are provided; do not redeclare them. Write any helper you need in the same source.
- Be robust: an item id may be missing from the sheet (treat it as unknown, so not provably safe), a time or party size may be null (treat a booking you can't confirm as within the rule as broken).

Violation messages are read out to the café owner on a big screen. Plain and specific, naming the item, number or time and her rule.
Example: "The reply says the banana bread is safe for a nut allergy. Your allergen sheet says it may contain nuts."
Say times the way a person would ("7.30pm"), never "19:30". No codes or ids in messages.

The types:
<domain.ts>
${readFileSync(new URL("./domain.ts", import.meta.url), "utf8").replace(/^import .*\n|^export type \{ Violation \};\n/gm, "")}
interface Violation { message: string }
</domain.ts>`;

export interface Proven {
  example: ChatExample;
  claims: Claims;
}

/** Reads every example reply once, so each attempt at the check is tested on the same promises. */
export async function readExamples(examples: ChatExample[], shop: Shop): Promise<Proven[]> {
  return Promise.all(examples.map(async (example, i) => ({ example, claims: await readClaims(example.customer, example.reply, shop, `claims.example${i + 1}`) })));
}

export async function generateChatCheck(rule: RuleSpec, read: Proven[], shop: Shop, feedback?: string): Promise<ChatGenerated> {
  const content = `The rule, as captured in the interview:
${JSON.stringify(rule, null, 2)}

The shop's facts every check receives as input.shop:
${JSON.stringify(shop)}

Replies the owner has seen, with what Claude found they promise, and her verdict:
${read.map((r) => `- ${r.example.id} (${r.example.verdict}): reply "${r.example.reply}" promises ${JSON.stringify(r.claims)}`).join("\n")}

Write the check, explain it in two plain sentences, and write exactly two extra test cases (as promises) that probe the edges the owner's replies don't already cover.${feedback ? `\n\nYour previous attempt failed. Fix it:\n${feedback}` : ""}`;
  return ask({ step: feedback ? "chat.generate.retry" : "chat.generate", system: SYSTEM, messages: [{ role: "user", content }], schema: Generated, effort: "high" });
}

export async function proveChatCheck(gen: ChatGenerated, read: Proven[], shop: Shop): Promise<Outcome[]> {
  const check = await compile<ReplyFacts>(gen.code);
  const cases = [
    ...read.map((r) => ({ name: r.example.id, source: "owner" as const, expected: r.example.verdict === "fine" ? ("pass" as const) : ("fail" as const), claims: r.claims })),
    ...gen.testCases.map((t) => ({ name: t.name, source: "generated" as const, expected: t.expect, claims: t.claims })),
  ];
  return cases.map((c): Outcome => {
    try {
      const violations = check({ claims: c.claims, shop });
      const got = violations.length === 0 ? "pass" : "fail";
      return { name: c.name, source: c.source, expected: c.expected, got, violations, ok: got === c.expected };
    } catch (err) {
      return { name: c.name, source: c.source, expected: c.expected, got: "error", violations: [], error: err instanceof Error ? err.message : String(err), ok: false };
    }
  });
}
