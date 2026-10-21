// Written by Claude from the interview on 2026-10-21. Chatbot rule: Only call something free from an allergen if the allergen sheet confirms it
import type { Allergen, AllergenEntry, Claims, ReplyFacts, Shop, Violation } from "../src/chat/domain.js";

export function check(input: ReplyFacts): Violation[] {
  const labels: Record<string, string> = {
    nuts: "nut",
    peanuts: "peanut",
    gluten: "gluten",
    dairy: "dairy",
    egg: "egg",
    soy: "soy",
    sesame: "sesame",
    celery: "celery",
  };
  const out: Violation[] = [];
  for (const c of input.claims.safeFor) {
    const label = labels[c.allergen] || c.allergen;
    const article = "aeiou".indexOf(label.charAt(0)) >= 0 ? "an " : "a ";
    const entry = input.shop.allergens.find((e) => e.id === c.item);
    if (!entry) {
      const plain = c.item.split("-").join(" ");
      out.push({
        message:
          "The reply says the " +
          plain +
          " is safe for " +
          article +
          label +
          " allergy. Your allergen sheet does not list it at all, so it cannot be promised safe. Tell the customer to ask at the counter.",
      });
      continue;
    }
    const name = entry.name.toLowerCase();
    if (entry.contains.indexOf(c.allergen) >= 0) {
      out.push({
        message:
          "The reply says the " +
          name +
          " is safe for " +
          article +
          label +
          " allergy. Your allergen sheet says it contains " +
          c.allergen +
          ".",
      });
    } else if (entry.mayContain.indexOf(c.allergen) >= 0) {
      out.push({
        message:
          "The reply says the " +
          name +
          " is safe for " +
          article +
          label +
          " allergy. Your allergen sheet says it may contain " +
          c.allergen +
          ".",
      });
    }
  }
  return out;
}
