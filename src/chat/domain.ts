// The chatbot's world: what a customer can ask about, Gráinne's allergen sheet, and the promises a reply makes.
// A check never reads the reply's wording; it reads the promises Claude found in it, against the shop's facts.
import type { Violation } from "../domain.js";

export type { Violation };

export type Allergen = "nuts" | "peanuts" | "gluten" | "dairy" | "egg" | "soy" | "sesame" | "celery";

/** One line of Gráinne's allergen sheet. "mayContain" means it can't be promised safe (shared kitchen, shared trays). */
export interface AllergenEntry {
  id: string;
  name: string;
  contains: Allergen[];
  mayContain: Allergen[];
}

/** The facts a check may use: the allergen sheet and the opening hours ("HH:MM", 24h, every day). */
export interface Shop {
  allergens: AllergenEntry[];
  openingHours: { open: string; close: string };
}

/** What a reply promises the customer, as Claude reads it. Empty lists when it promises nothing of that kind. */
export interface Claims {
  /** The reply says or implies this item is free of this allergen, or safe for someone with that allergy. */
  safeFor: { item: string; allergen: Allergen }[];
  /** Any money off, freebie, voucher or price lower than the menu, offered or promised. */
  discounts: { what: string }[];
  /** A table the reply books, confirms or offers. Time is "HH:MM" 24h, or null if not said. */
  bookings: { partySize: number | null; day: string | null; time: string | null }[];
}

/** What every chatbot check receives. */
export interface ReplyFacts {
  claims: Claims;
  shop: Shop;
}

export type ChatCheckFn = (input: ReplyFacts) => Violation[];
