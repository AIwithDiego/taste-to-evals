// Reads a draft reply for what it promises the customer. Claude only reports the promises; it doesn't judge them.
// Code then checks each promise against Gráinne's rules.
import { z } from "zod";
import { ask } from "../claude.js";
import type { Claims, Shop } from "./domain.js";

const ALLERGENS = ["nuts", "peanuts", "gluten", "dairy", "egg", "soy", "sesame", "celery"] as const;

const ClaimsSchema = z.object({
  safeFor: z
    .array(z.object({ item: z.string().describe("The item's id from the list"), allergen: z.enum(ALLERGENS) }))
    .describe("Each item the reply says or implies is free of an allergen, or fine for someone with that allergy. Include 'no nuts in it', 'nut-free', 'should be fine for her', 'safe for coeliacs' (gluten). Not when the reply says it can't promise, or says it contains it."),
  discounts: z
    .array(z.object({ what: z.string().describe("The offer in a few lower-case words that read after 'offers', e.g. '20% off for a birthday', 'a free coffee next time'") }))
    .describe("Each discount, freebie, voucher, 'on us', loyalty reward or price lower than the menu that the reply offers or promises. Not when it says there are no discounts."),
  bookings: z
    .array(
      z.object({
        partySize: z.number().int().nullable(),
        day: z.string().nullable().describe("As said, e.g. 'Saturday'"),
        time: z.string().nullable().describe("24h HH:MM, e.g. '19:30' for half seven in the evening"),
      }),
    )
    .describe("Each table the reply books, confirms or offers to book. Not when it says it can't, or tells them to ring."),
});

export async function readClaims(customer: string, reply: string, shop: Shop, step = "claims"): Promise<Claims> {
  return ask({
    step,
    system: `You read a café chatbot's reply and list exactly what it promises the customer. You don't judge whether the promise is right; you only report it, faithfully.
Items, by id: ${shop.allergens.map((a) => `${a.id} (${a.name})`).join(", ")}.`,
    messages: [{ role: "user", content: `The customer wrote:\n"${customer}"\n\nThe reply:\n"${reply}"\n\nList what the reply promises.` }],
    schema: ClaimsSchema,
    effort: "low",
  });
}

/** The promises in plain words, for the screen. */
export function describeClaims(c: Claims, shop: Shop): string[] {
  const name = (id: string) => shop.allergens.find((a) => a.id === id)?.name.toLowerCase() ?? id;
  return [
    ...c.safeFor.map((s) => `Says the ${name(s.item)} is safe for a ${s.allergen === "nuts" ? "nut" : s.allergen} allergy`),
    ...c.discounts.map((d) => `Offers ${d.what}`),
    ...c.bookings.map((b) => `Books a table${b.partySize ? ` for ${b.partySize}` : ""}${b.day ? ` on ${b.day}` : ""}${b.time ? ` at ${b.time}` : ""}`),
  ];
}
