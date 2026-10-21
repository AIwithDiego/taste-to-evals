// Gráinne's rules for the website chatbot: how she'd jot them down, what the interview asks about, how each is checked.
import { CHAT_EXAMPLES, type ChatExample, type ChatRuleId } from "./examples.js";

export interface ChatRuleDef {
  id: ChatRuleId;
  handwritten: string;
  topic: string;
  kind: "typed" | "judged";
}

export const CHAT_RULES: ChatRuleDef[] = [
  { id: "allergens", handwritten: "Never promise it's safe for an allergy", topic: "allergens: what the website chat may tell customers about allergies and what's safe for them to eat", kind: "typed" },
  { id: "discounts", handwritten: "No discounts, ever", topic: "discounts: whether the website chat can offer money off or anything free", kind: "typed" },
  { id: "bookings", handwritten: "Tables up to 8, last one at 7pm", topic: "table bookings: which bookings the website chat can take", kind: "typed" },
  { id: "tone", handwritten: "Sound like us", topic: "how the website chat should sound when it talks to customers", kind: "judged" },
];

export const TYPED_CHAT_RULES = CHAT_RULES.filter((r) => r.kind === "typed");

export function chatExamplesFor(id: ChatRuleId): ChatExample[] {
  return CHAT_EXAMPLES[id];
}
