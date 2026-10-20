// The interview: Claude asks the café owner about one rule until it can be written down precisely.
// The owner is role-played by a second Claude call that answers only from the owner's notes.
import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ask } from "./claude.js";

export const RuleSpec = z.object({
  title: z.string().describe("Short name, e.g. 'Max 40 hours a week'"),
  ownerWords: z.string().describe("The rule in the owner's own words, one or two sentences"),
  precise: z.string().describe("The exact rule: what is measured, the limit, what counts, the boundary (is the limit itself allowed?)"),
  exceptions: z.string().describe("Exceptions the owner gave, or 'None'"),
  kind: z.enum(["typed", "judged"]).describe("typed = code can decide it from the facts alone (the rota, or what a reply promises); judged = needs judgement"),
  whyKind: z.string().describe("One plain sentence on why it's typed or judged"),
});
export type RuleSpec = z.infer<typeof RuleSpec>;

const InterviewerTurn = z.object({
  say: z.string().describe("What you say to the owner next. One short question, or a short read-back when done."),
  done: z.boolean().describe("true once you can state the rule precisely and the owner has confirmed your read-back"),
  rule: RuleSpec.nullable().describe("The captured rule when done, otherwise null"),
});

const OwnerTurn = z.object({ say: z.string() });

export interface Line {
  who: "interviewer" | "owner";
  text: string;
}

/** What ShiftGuard checks, for the interviewer's opening line. */
export const ROTA_SUBJECT = "staff rotas drafted by an AI assistant, before anyone approves them";
export const CHAT_SUBJECT = "replies written by the café's website chatbot, before they reach a customer";

const interviewerBase = (subject: string) => `You are the setup assistant in ShiftGuard, a tool that checks ${subject}, against the business owner's own rules.
You are interviewing the owner of a café to capture ONE rule, about the topic given below, precisely enough that it can be checked automatically.

How you talk:
- Plain, warm, short. The owner is busy and not technical. No jargon (never say "typed", "function", "boolean", "threshold").
- One question per turn, at most two sentences.
- Owners rarely know their rules up front; they know what went wrong. So never open by asking for the rule. Open by asking about a time this went wrong (a bad week, a bad shift, a bad reply). Then work from that story: what exactly made it wrong, where the line is, and whether it applies every time. Never suggest a number or a limit yourself; let her name it.
- From the story, find out: what is measured, the exact limit or condition, whether the limit itself is allowed, what counts, the hours or days it applies to, and any exceptions.
- Don't ask what you already know from their answers.
- When you have it, read the rule back in one or two plain sentences and ask them to confirm. When they confirm, set done to true, fill in rule, and say a short thanks.
- Some rules are judgement calls. If the owner says they wouldn't put a number on it, don't push for one: capture the spirit, what would clearly be wrong, and who it protects, and mark it judged.
- Aim to finish in five questions or fewer, read-back included.`;

function ownerPrompt(topic: string): string {
  const notes = readFileSync(new URL("../data/ollies/owner-notes.md", import.meta.url), "utf8");
  return `You are role-playing the owner of a café in a product demo. Stay in character.
Answer ONLY from your notes below. If the notes don't cover something, say you haven't thought about it and give a sensible owner's answer.
Today you are setting up your rule about ${topic}; don't bring up your other rules.
Talk like a busy, friendly Dublin café owner: one or two short sentences, no lists, no technical words.
Like most owners, you've never written your rules down. Asked what went wrong, tell the story and how it felt; don't state a rule or a number yet. Give the exact line only when asked where it is, and say it plainly and consistently (for example "forty is fine, anything over forty is not").

<notes>
${notes}
</notes>`;
}

export async function interview(
  topic: string,
  hooks: { line?: (line: Line) => void; status?: (text: string) => void } = {},
  subject = ROTA_SUBJECT,
): Promise<{ lines: Line[]; rule: RuleSpec }> {
  const lines: Line[] = [];
  const owner = ownerPrompt(topic);
  const INTERVIEWER = `${interviewerBase(subject)}\n\nToday's topic: ${topic}.`;
  const add = (line: Line) => {
    lines.push(line);
    hooks.line?.(line);
  };

  for (let turn = 0; turn < 8; turn++) {
    // The interviewer sees the owner as "user"; the owner sees the interviewer as "user".
    const forInterviewer: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: "(The owner has opened the rules setup. Start the interview.)" },
      ...lines.map((l): Anthropic.Beta.BetaMessageParam => ({ role: l.who === "interviewer" ? "assistant" : "user", content: l.text })),
    ];
    hooks.status?.(turn === 0 ? "ShiftGuard opens the interview" : "ShiftGuard thinks about what to ask next");
    const next = await ask({ step: `interview.ask.${turn + 1}`, system: INTERVIEWER, messages: forInterviewer, schema: InterviewerTurn, effort: "medium" });
    add({ who: "interviewer", text: next.say });
    if (next.done && next.rule) return { lines, rule: next.rule };

    const forOwner: Anthropic.Beta.BetaMessageParam[] = lines.map((l) => ({ role: l.who === "interviewer" ? "user" : "assistant", content: l.text }));
    hooks.status?.("Gráinne answers");
    const reply = await ask({ step: `interview.owner.${turn + 1}`, system: owner, messages: forOwner, schema: OwnerTurn, effort: "low" });
    add({ who: "owner", text: reply.say });
  }
  throw new Error("Interview didn't settle on a rule in eight turns");
}
