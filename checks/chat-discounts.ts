// Written by Claude from the interview on 2026-10-21. Chatbot rule: No discounts or freebies from the chat
import type { Allergen, AllergenEntry, Claims, ReplyFacts, Shop, Violation } from "../src/chat/domain.js";

export function check(input: ReplyFacts): Violation[] {
  const out: Violation[] = [];
  for (const d of input.claims.discounts) {
    out.push({
      message:
        "The reply offers " +
        d.what +
        ". Your rule is that the chat offers no money off, discounts or freebies, and the menu lists no offers it could point to.",
    });
  }
  return out;
}
