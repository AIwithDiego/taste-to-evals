// The AI judge for "sound like us": a rubric written from the interview, applied to a reply only once every code check passes.
import { z } from "zod";
import { ask } from "../claude.js";
import type { RuleSpec } from "../interview.js";
import { Rubric } from "../judge.js";
import type { ChatExample } from "./examples.js";

const Verdict = z.object({
  verdict: z.enum(["fine", "not fine"]),
  reason: z.string().describe("One plain sentence for the owner"),
  confidence: z.enum(["low", "medium", "high"]),
});
export type ReplyVerdict = z.infer<typeof Verdict>;

export async function writeToneRubric(rule: RuleSpec, examples: ChatExample[], feedback?: string): Promise<Rubric> {
  return ask({
    step: feedback ? "chat.rubric.retry" : "chat.rubric",
    system: "You turn a café owner's sense of how her website chat should sound into a short rubric an AI judge will apply to one reply. Only how it sounds: wording, warmth, length, punctuation. Leave out what it says or promises (allergens, discounts, bookings, refunds): other checks cover those. Plain words, her spirit, no scoring formulas.",
    messages: [{
      role: "user",
      content: `The rule from the interview:\n${JSON.stringify(rule, null, 2)}\n\nReplies she judged:\n${examples.map((e) => `- (${e.verdict}) "${e.reply}" (she said: ${e.said})`).join("\n")}\n\nWrite the rubric.${feedback ? `\n\nYour last rubric led the judge to get these wrong. Fix it:\n${feedback}` : ""}`,
    }],
    schema: Rubric,
    effort: "medium",
  });
}

export async function judgeReply(customer: string, reply: string, rule: RuleSpec, rubric: Rubric, step = "chat.judge"): Promise<ReplyVerdict> {
  return ask({
    step,
    system: `You are the judge in ShiftGuard. You decide one rule a café owner can't put in numbers: whether a reply from her website chat sounds like her café. Judge only the tone, not the facts. Apply the rubric in her spirit; ordinary friendly replies are fine. Your reason is read out to her: one plain sentence.`,
    messages: [{
      role: "user",
      content: `Rule: ${rule.title}\nIn her words: "${rule.ownerWords}"\nRubric:\n${rubric.criteria.map((c) => `- ${c}`).join("\n")}\nFine when: ${rubric.fineWhen}\nNot fine when: ${rubric.notFineWhen}\n\nThe customer wrote: "${customer}"\nThe reply: "${reply}"`,
    }],
    schema: Verdict,
    effort: "low",
  });
}
