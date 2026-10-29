// The AI judge, for rules code can't decide ("weekends shared fairly"). Setup turns the owner's words into a
// short rubric; the gate asks the judge for a verdict only after every code check has passed.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ask } from "./claude.js";
import type { Rota } from "./domain.js";
import type { Example } from "./examples.js";
import type { RuleSpec } from "./interview.js";

export const Rubric = z.object({
  criteria: z.array(z.string()).describe("Three to five plain-language points the judge weighs, in the owner's spirit"),
  fineWhen: z.string().describe("One sentence: when a week is fine"),
  notFineWhen: z.string().describe("One sentence: when a week is not fine"),
});
export type Rubric = z.infer<typeof Rubric>;

const Verdict = z.object({
  verdict: z.enum(["fine", "not fine"]),
  reason: z.string().describe("One or two plain sentences for the owner, naming people and numbers"),
  confidence: z.enum(["low", "medium", "high"]),
});
export type Verdict = z.infer<typeof Verdict>;

/** What the judge sees: who works the weekend this week, the last month, and who asked to be off. Worked out by code. */
export function weekendPicture(rota: Rota) {
  const isWeekend = (date: string) => [6, 0].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const history = rota.weekendHistory ?? {};
  const counted = rota.staff.filter((p) => history[p.id] !== undefined);
  const average = counted.length ? counted.reduce((n, p) => n + (history[p.id] ?? 0), 0) / counted.length : 0;
  return {
    howToRead: "Each weekend has 2 days (Saturday, Sunday); a person works at most one shift a day. Over the last four weeks that is at most 8 weekend days per person.",
    teamAverageLastFourWeeks: `${average.toFixed(1)} of 8 weekend days`,
    people: rota.staff.map((p) => {
      const mine = rota.shifts.filter((s) => s.staffId === p.id && isWeekend(s.date));
      const last = history[p.id];
      return {
        name: p.name,
        thisWeekend: mine.length ? [...new Set(mine.map((s) => (new Date(`${s.date}T12:00:00Z`).getUTCDay() === 6 ? "Saturday" : "Sunday")))].join(" and ") : "off",
        lastFourWeeks: last === undefined ? "unknown" : `${last} of 8 weekend days`,
      };
    }),
  };
}

function ownerContext(): string {
  const notes = readFileSync(new URL("../data/ollies/owner-notes.md", import.meta.url), "utf8");
  const weekends = notes.slice(notes.indexOf("## Weekends"));
  return weekends.split(/\n#{1,2} /)[0] ?? weekends;
}

export async function writeRubric(rule: RuleSpec, examples: Example[], feedback?: string): Promise<Rubric> {
  return ask({
    step: feedback ? "rubric.retry" : "rubric",
    system: "You turn a café owner's fuzzy rule into a short rubric an AI judge will apply to a week's rota. Plain words, the owner's spirit, no scoring formulas.",
    messages: [{
      role: "user",
      content: `The rule from the interview:\n${JSON.stringify(rule, null, 2)}\n\nWeeks the owner judged:\n${examples.map((e) => `- (${e.verdict}) ${e.said}`).join("\n")}\n\nWrite the rubric.${feedback ? `\n\nYour last rubric led the judge to get these wrong. Fix it:\n${feedback}` : ""}`,
    }],
    schema: Rubric,
    effort: "medium",
  });
}

export async function judge(rota: Rota, rule: RuleSpec, rubric: Rubric, step = "judge"): Promise<Verdict> {
  return ask({
    step,
    system: `You are the judge in ShiftGuard. You decide one rule a café owner can't put in numbers. Apply the rubric in the owner's spirit.
Say "not fine" when the owner would object, for example: someone who asked to be off weekends is on one; or the people who have carried well above the team average of weekend days lately are on both days again while others with far fewer get little or nothing.
Say "fine" for ordinary spreads where nobody is clearly carrying it: being at or near the team average, or one extra day for someone, is fine.
Your reason is read out to the owner: plain, short, names and numbers.`,
    messages: [{
      role: "user",
      content: `Rule: ${rule.title}\nIn the owner's words: "${rule.ownerWords}"\nRubric:\n${rubric.criteria.map((c) => `- ${c}`).join("\n")}\nFine when: ${rubric.fineWhen}\nNot fine when: ${rubric.notFineWhen}\n\nWhat the owner has said about it:\n${ownerContext()}\n\nThis week's weekend picture (worked out from the rota):\n${JSON.stringify(weekendPicture(rota), null, 2)}\n\nWho can't work which days this week:\n${JSON.stringify(rota.staff.filter((p) => p.unavailable.length).map((p) => ({ name: p.name, unavailable: p.unavailable })))}`,
    }],
    schema: Verdict,
    effort: "medium",
  });
}
