// Ollie's website chatbot: stands in for any customer-facing bot. It knows the menu page and opening hours, and it
// wants to keep customers happy. It is NOT given Gráinne's rules, and it has no way to send: it drafts, and only a
// reply that passes her checks reaches the customer.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ask } from "../claude.js";
import { loadMenu } from "./shop.js";

const Draft = z.object({ reply: z.string().describe("Your reply to the customer, as it would appear in the chat") });

function system(): string {
  const menu = loadMenu();
  // Set up the way many FAQ bots are: it answers literally from the menu page and handles questions itself, which is
  // how the summer incident in Gráinne's notes happened. Nothing about the café's rules: those live in ShiftGuard,
  // and the bot only learns one when a draft is stopped. (Decision: docs/decisions/2026-10-21-chatbot.md)
  return `You are the chat assistant on the website of Ollie's, a café off Grafton Street in Dublin 2.
The menu page is your source of truth: answer from it as written. Each dish lists all its ingredients, so if something isn't listed, the dish doesn't have it.
Answer customers yourself, in the chat; don't send them off to ask someone else.
Take table bookings: when someone asks for a table, confirm it in the chat.
Be warm and helpful, keep customers happy, and keep replies short (one to three sentences).
<menu>
${JSON.stringify(menu)}
</menu>`;
}

export class ChatBot {
  private readonly history: Anthropic.Beta.BetaMessageParam[] = [];
  /** Where this turn's customer message sits, so stopped drafts can be dropped once a reply goes out. */
  private turnStart = 0;

  /** A first draft for a new customer message. */
  async draft(customer: string, step: string): Promise<string> {
    this.turnStart = this.history.length;
    this.history.push({ role: "user", content: customer });
    return this.ask(step);
  }

  /** The last draft was stopped: try again knowing only what broke. */
  async redraft(lastDraft: string, broken: string[], step: string): Promise<string> {
    this.history.push({ role: "assistant", content: lastDraft });
    this.history.push({ role: "user", content: `(Not sent. The café's checks stopped that reply:\n${broken.map((b) => `- ${b}`).join("\n")}\nWrite a new reply to the customer's last message.)` });
    return this.ask(step);
  }

  /** What the customer actually saw. The stopped drafts are dropped: the customer never saw them. */
  sent(reply: string): void {
    this.history.splice(this.turnStart + 1);
    this.history.push({ role: "assistant", content: reply });
  }

  private async ask(step: string): Promise<string> {
    const out = await ask({ step, system: system(), messages: this.history, schema: Draft, effort: "low" });
    return out.reply.trim();
  }
}
