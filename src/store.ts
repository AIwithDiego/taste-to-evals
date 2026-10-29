// The run store: a local SQLite file. Proposals are logged here; a rota only becomes
// the approved rota through approve(), which re-runs every check itself before writing.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Rota } from "./domain.js";
import { runChecks, type GateResult } from "./gate.js";
import type { Claims, Shop } from "./chat/domain.js";
import { loadChatChecks } from "./chat/gate.js";
import * as telemetry from "./telemetry.js";

mkdirSync("runs", { recursive: true });
const db = new DatabaseSync(process.env["SHIFTGUARD_DB"] ?? "runs/shiftguard.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    request TEXT NOT NULL,
    round INTEGER NOT NULL,
    note TEXT NOT NULL,
    rota_json TEXT NOT NULL,
    gate_json TEXT NOT NULL,
    passed INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    customer TEXT NOT NULL,
    reply TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent', 'held')),
    tries_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS approved_rotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    rota_json TEXT NOT NULL
  );
`);

// The recorded run in replay/ refers to two proposals. Load them so its Approve works on a fresh clone.
if (existsSync("replay/proposals.json")) {
  const insert = db.prepare("INSERT OR IGNORE INTO proposals (id, created_at, request, round, note, rota_json, gate_json, passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of JSON.parse(readFileSync("replay/proposals.json", "utf8")) as Record<string, string | number>[]) {
    insert.run(r["id"]!, r["created_at"]!, r["request"]!, r["round"]!, r["note"]!, r["rota_json"]!, r["gate_json"]!, r["passed"]!);
  }
}

export function recordProposal(p: { request: string; round: number; note: string; rota: Rota; gate: GateResult }): string {
  const id = randomUUID().slice(0, 8);
  db.prepare("INSERT INTO proposals (id, created_at, request, round, note, rota_json, gate_json, passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, new Date().toISOString(), p.request, p.round, p.note, JSON.stringify(p.rota), JSON.stringify(p.gate), p.gate.passed ? 1 : 0,
  );
  return id;
}

export type ApproveResult = { ok: true; approvedId: number; already: boolean; message: string } | { ok: false; message: string };

/** The only write path for a rota. Refuses anything that didn't pass, and re-runs the code checks here rather than
 *  trusting the stored result. The judge's verdict is taken from the gate run (it's an AI call, so not re-asked). */
export async function approve(proposalId: string, approvedBy: string): Promise<ApproveResult> {
  const row = db.prepare("SELECT rota_json, passed FROM proposals WHERE id = ?").get(proposalId);
  if (!row) return { ok: false, message: `There's no proposal ${proposalId}.` };
  if (row["passed"] !== 1) return { ok: false, message: "This rota broke at least one of your rules, so it can't be approved." };
  const rota: Rota = JSON.parse(String(row["rota_json"]));
  const broken = (await runChecks(rota)).filter((r) => r.violations.length);
  if (broken.length) return { ok: false, message: `Re-checked just now and it breaks: ${broken.map((b) => b.title).join(", ")}. Not approved.` };
  const existing = db.prepare("SELECT id, approved_by FROM approved_rotas WHERE proposal_id = ?").get(proposalId);
  // Approving again (e.g. when a run is replayed for the video) changes nothing and says so.
  if (existing) return { ok: true, approvedId: Number(existing["id"]), already: true, message: `Already approved by ${String(existing["approved_by"])}. It's the rota for the week.` };
  telemetry.capture("shiftguard_approved", { agent: "rota", proposal_id: proposalId, approved_by: approvedBy });
  void telemetry.flush();
  const result = db.prepare("INSERT INTO approved_rotas (proposal_id, approved_by, approved_at, rota_json) VALUES (?, ?, ?, ?)").run(
    proposalId, approvedBy, new Date().toISOString(), JSON.stringify(rota),
  );
  return { ok: true, approvedId: Number(result.lastInsertRowid), already: false, message: `Approved by ${approvedBy}. This is now the rota for the week.` };
}

export function approvedCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM approved_rotas").get();
  return Number(row?.["n"] ?? 0);
}

/** A stored proposal's week, for the screen's recap. Read-only. */
export function getProposal(id: string): { rota: Rota; request: string; round: number; passed: boolean } | undefined {
  const row = db.prepare("SELECT rota_json, request, round, passed FROM proposals WHERE id = ?").get(id);
  if (!row) return undefined;
  return { rota: JSON.parse(String(row["rota_json"])), request: String(row["request"]), round: Number(row["round"]), passed: row["passed"] === 1 };
}

/* ---------- the website chatbot ---------- */

export interface ChatTry {
  reply: string;
  claims: Claims;
  passed: boolean;
  broken: string[];
}

/** The only way a chatbot reply reaches a customer. Refuses unless the last try passed, and re-runs the code
 *  checks on its promises here rather than trusting the gate's word. The tone verdict is taken from the gate run. */
export async function deliver(conversationId: string, customer: string, tries: ChatTry[], shop: Shop): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  const last = tries.at(-1);
  if (!last?.passed) return { ok: false, message: "That reply broke at least one of your rules, so it can't be sent." };
  const broken = (await loadChatChecks()).filter((c) => c.run({ claims: last.claims, shop }).length);
  if (broken.length) return { ok: false, message: `Re-checked just now and it breaks: ${broken.map((b) => b.rule.title).join(", ")}. Not sent.` };
  const r = db.prepare("INSERT INTO chat_messages (conversation_id, created_at, customer, reply, status, tries_json) VALUES (?, ?, ?, ?, 'sent', ?)").run(
    conversationId, new Date().toISOString(), customer, last.reply, JSON.stringify(tries),
  );
  return { ok: true, id: Number(r.lastInsertRowid) };
}

/** Every try failed: the customer gets a holding line, and the question waits for Gráinne. */
export function holdForOwner(conversationId: string, customer: string, holding: string, tries: ChatTry[]): number {
  const r = db.prepare("INSERT INTO chat_messages (conversation_id, created_at, customer, reply, status, tries_json) VALUES (?, ?, ?, ?, 'held', ?)").run(
    conversationId, new Date().toISOString(), customer, holding, JSON.stringify(tries),
  );
  return Number(r.lastInsertRowid);
}

/** Who approved a proposal and when, for the evidence pack. Read-only. */
export function approvalOf(proposalId: string): { by: string; at: string } | undefined {
  const row = db.prepare("SELECT approved_by, approved_at FROM approved_rotas WHERE proposal_id = ?").get(proposalId);
  return row ? { by: String(row["approved_by"]), at: String(row["approved_at"]) } : undefined;
}
