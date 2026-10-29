// Gráinne's rules: how she'd scribble them, what the interview asks about, and how each is checked.
import { EXAMPLES, FAIR_EXAMPLES, type Example } from "./examples.js";

export type TypedRuleId = keyof typeof EXAMPLES;
export type RuleId = TypedRuleId | "fair";

export interface RuleDef {
  id: RuleId;
  handwritten: string;
  /** What the interviewer is told to ask about. */
  topic: string;
  kind: "typed" | "judged";
}

export const RULES: RuleDef[] = [
  { id: "hours", handwritten: "Nobody over 40 hours a week", topic: "working hours: how many hours a week someone can be rostered", kind: "typed" },
  { id: "rest", handwritten: "11 hours off between shifts", topic: "rest: how much time off someone needs between one shift and the next", kind: "typed" },
  { id: "staffing", handwritten: "Two in always, three Sat morning", topic: "staffing levels: how many people must be in while the café is open", kind: "typed" },
  { id: "barista", handwritten: "A barista on at all times", topic: "skills cover: whether someone trained on the coffee machine must always be on", kind: "typed" },
  { id: "availability", handwritten: "Respect when people can't work", topic: "availability: what happens with days people have said they can't work", kind: "typed" },
  { id: "fair", handwritten: "Weekends shared fairly", topic: "fairness: how weekend shifts are shared out", kind: "judged" },
];

export const TYPED_RULES = RULES.filter((r): r is RuleDef & { id: TypedRuleId } => r.kind === "typed");

export function examplesFor(id: RuleId): Example[] {
  return id === "fair" ? FAIR_EXAMPLES : EXAMPLES[id];
}
