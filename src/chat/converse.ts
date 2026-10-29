// One customer conversation with the website chatbot, every draft through Gráinne's gate.
// A passing reply is delivered; a failing one goes back to the bot with only what broke. Customers can't wait
// for a person to approve every message, so after three stopped drafts the question is held for Gráinne instead.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { callLog } from "../claude.js";
import type { ChatEvent, ChatRecord } from "../events.js";
import { deliver, holdForOwner, type ChatTry } from "../store.js";
import { ChatBot } from "./bot.js";
import { describeClaims } from "./claims.js";
import { runChatGate } from "./gate.js";
import { loadShop } from "./shop.js";
import * as telemetry from "../telemetry.js";

export const MAX_TRIES = 3;
export const HOLDING_LINE = "Thanks for that. Let me check with the team, and someone will get back to you here shortly.";

export const DEFAULT_CONVERSATION = [
  "Hi! Is the banana bread safe for my son? He's allergic to nuts.",
  "Ah ok, thanks. It's his birthday on Saturday, could we book a table for 10 at half 7 that evening?",
];

export async function runConversation(messages: string[], emit: (e: ChatEvent) => void): Promise<ChatRecord> {
  const started = new Date();
  const events: ChatEvent[] = [];
  const send = (e: ChatEvent) => {
    events.push(e);
    emit(e);
  };
  callLog.length = 0;
  telemetry.startTrace("website chat", { messages });
  const shop = loadShop();
  const bot = new ChatBot();
  const conversationId = randomUUID().slice(0, 8);
  let sentCount = 0;
  let heldCount = 0;
  try {
    send({ t: "start", messages });
    for (const [i, customer] of messages.entries()) {
      const turn = i + 1;
      send({ t: "customer", turn, text: customer });
      const tries: ChatTry[] = [];
      send({ t: "status", text: "The chatbot drafts a reply" });
      let reply = await bot.draft(customer, `chat.bot.${turn}.1`);
      for (let attempt = 1; ; attempt++) {
        send({ t: "draft", turn, attempt, reply });
        const gate = await runChatGate(customer, reply, shop, {
          claims: (c) => send({ t: "claims", turn, attempt, lines: describeClaims(c, shop) }),
          result: (result) => {
            send({ t: "check", turn, attempt, result });
            telemetry.check({ agent: "chat", attempt, ruleId: result.ruleId, title: result.title, by: result.by, skipped: result.skipped === true, messages: result.violations.map((v) => v.message), ...(result.reason ? { reason: result.reason } : {}) });
          },
        }, `chat.${turn}.${attempt}`);
        const broken = gate.results.flatMap((r) => r.violations.map((v) => v.message));
        tries.push({ reply, claims: gate.claims, passed: gate.passed, broken });
        send({ t: "verdict", turn, attempt, passed: gate.passed, broken });
        telemetry.capture("shiftguard_gate_run", { agent: "chat", turn, attempt, passed: gate.passed, broken_rules: gate.results.filter((r) => r.violations.length).map((r) => r.ruleId) });
        if (gate.passed) {
          const d = await deliver(conversationId, customer, tries, shop);
          if (!d.ok) throw new Error(d.message);
          bot.sent(reply);
          sentCount++;
          send({ t: "sent", turn, reply, attempts: attempt, messageId: d.id });
          telemetry.capture("shiftguard_reply_sent", { turn, tries: attempt });
          break;
        }
        if (attempt >= MAX_TRIES) {
          const id = holdForOwner(conversationId, customer, HOLDING_LINE, tries);
          bot.sent(HOLDING_LINE);
          heldCount++;
          send({ t: "held", turn, attempts: attempt, holding: HOLDING_LINE, lastDraft: reply, messageId: id });
          telemetry.capture("shiftguard_reply_held", { turn, tries: attempt });
          break;
        }
        send({ t: "status", text: "The chatbot tries again" });
        reply = await bot.redraft(reply, broken, `chat.bot.${turn}.${attempt + 1}`);
      }
    }
    const runFile = `runs/chat-${started.toISOString().replace(/[:.]/g, "-")}.json`;
    const costUsd = callLog.reduce((s, c) => s + c.costUsd, 0);
    telemetry.capture("shiftguard_run", { agent: "chat", sent: sentCount, held: heldCount, cost_usd: costUsd, claude_calls: callLog.length });
    await telemetry.endTrace({ sent: sentCount, held: heldCount, costUsd });
    send({ t: "done", sent: sentCount, held: heldCount, costUsd, calls: [...callLog], runFile });
    mkdirSync("runs", { recursive: true });
    const record: ChatRecord = { started: started.toISOString(), events };
    writeFileSync(runFile, JSON.stringify(record, null, 2));
    return record;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await telemetry.endTrace(undefined, message);
    send({ t: "error", message });
    throw err;
  }
}
