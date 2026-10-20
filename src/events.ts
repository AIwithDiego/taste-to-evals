// What the setup run reports as it goes. The terminal prints these; the demo screen animates them.
import type { CallRecord } from "./claude.js";
import type { Outcome } from "./generate.js";
import type { RuleResult } from "./gate.js";
import type { Line, RuleSpec } from "./interview.js";

export interface WeekShown {
  id: string;
  said: string;
  verdict: "fine" | "not fine";
  /** Chatbot examples only: the customer's message and the reply she judged. */
  customer?: string;
  reply?: string;
}

export type SetupEvent =
  | { t: "start"; cafe: string; owner: string; ruleId: string; handwritten: string }
  | { t: "status"; text: string }
  | { t: "line"; line: Line }
  | { t: "rule"; rule: RuleSpec }
  | { t: "examples"; weeks: WeekShown[] }
  | { t: "retry"; attempt: number; feedback: string }
  | { t: "outcome"; outcome: Outcome; short?: string; why?: string }
  | { t: "saved"; howItWorks: string; code: string; file: string }
  | { t: "done"; costUsd: number; calls: CallRecord[]; runFile: string }
  | { t: "error"; message: string };

export interface SetupRecord {
  started: string;
  events: SetupEvent[];
}

export type ProposeEvent =
  | { t: "start"; request: string; from: string }
  | { t: "status"; text: string }
  | { t: "noted"; text: string }
  | { t: "read"; tool: string; text: string }
  | { t: "proposal"; round: number; note: string; lines: string[] }
  | { t: "check"; round: number; result: RuleResult }
  | { t: "verdict"; round: number; passed: boolean; proposalId: string; broken: string[] }
  | { t: "done"; passed: boolean; proposalId: string; rounds: number; costUsd: number; calls: CallRecord[]; runFile: string }
  | { t: "error"; message: string };

export interface ProposeRecord {
  started: string;
  events: ProposeEvent[];
}

export type ChatEvent =
  | { t: "start"; messages: string[] }
  | { t: "customer"; turn: number; text: string }
  | { t: "status"; text: string }
  | { t: "draft"; turn: number; attempt: number; reply: string }
  | { t: "claims"; turn: number; attempt: number; lines: string[] }
  | { t: "check"; turn: number; attempt: number; result: RuleResult }
  | { t: "verdict"; turn: number; attempt: number; passed: boolean; broken: string[] }
  | { t: "sent"; turn: number; reply: string; attempts: number; messageId: number }
  | { t: "held"; turn: number; attempts: number; holding: string; lastDraft: string; messageId: number }
  | { t: "done"; sent: number; held: number; costUsd: number; calls: CallRecord[]; runFile: string }
  | { t: "error"; message: string };

export interface ChatRecord {
  started: string;
  events: ChatEvent[];
}
