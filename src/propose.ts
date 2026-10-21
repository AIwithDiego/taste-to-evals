// One request from the owner, start to finish: the assistant suggests, the checks decide, it revises if sent back.
// Nothing here writes a rota. The result waits for the owner's Approve.
import { mkdirSync, writeFileSync } from "node:fs";
import { RotaAssistant, type Proposal } from "./agent.js";
import { callLog } from "./claude.js";
import type { Rota, Shift } from "./domain.js";
import type { ProposeEvent, ProposeRecord } from "./events.js";
import { applyChange, type Change } from "./examples.js";
import { runGate } from "./gate.js";
import { baseWeek } from "./ollies.js";
import { noteAbsences, withAbsences } from "./request.js";
import { recordProposal } from "./store.js";
import * as telemetry from "./telemetry.js";

const MAX_ROUNDS = 5;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KIND_WORD: Record<Shift["kind"], string> = { open: "opening", mid: "rush shift", close: "close" };
const READ_WORDS: Record<string, string> = {
  read_week: "The assistant reads this week's rota",
  read_staff: "The assistant reads the staff list",
};

function toChange(p: Proposal): Change {
  return {
    remove: p.changes.remove,
    add: p.changes.add.map((a) => ({ staffId: a.staffId, day: a.day, kind: a.kind, start: a.start ?? undefined, end: a.end ?? undefined })),
  };
}

function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}` : String(hour);
}

function dayRange(dates: string[], weekStart: string): string {
  const names = [...dates].sort().map((d) => dayOf(d, weekStart));
  if (names.length === 7) return "all week";
  if (names.length > 2) return `${names[0]} to ${names.at(-1)}`;
  return names.join(" and ");
}

function dayOf(date: string, weekStart: string): string {
  const i = Math.round((Date.parse(date) - Date.parse(weekStart)) / 86400000);
  return DAYS[i] ?? date;
}

/** The changes in plain words, e.g. "Niamh opens Monday, 6:30 to 2:30". */
export function describe(before: Rota, after: Rota): string[] {
  const name = (id: string) => before.staff.find((p) => p.id === id)?.name.split(" ")[0] ?? id;
  const beforeIds = new Set(before.shifts.map((s) => s.id));
  const afterIds = new Set(after.shifts.map((s) => s.id));
  const removed = before.shifts.filter((s) => !afterIds.has(s.id)).map((s) => `${name(s.staffId)}'s ${dayOf(s.date, before.weekStart)} ${KIND_WORD[s.kind]} comes off`);
  const added = after.shifts.filter((s) => !beforeIds.has(s.id)).map((s) => `${name(s.staffId)} takes the ${dayOf(s.date, before.weekStart)} ${KIND_WORD[s.kind]}, ${clock(s.start)} to ${clock(s.end)}`);
  return [...removed, ...added];
}

export async function runProposal(request: string, emit: (e: ProposeEvent) => void): Promise<ProposeRecord> {
  const started = new Date();
  const events: ProposeEvent[] = [];
  const send = (e: ProposeEvent) => {
    events.push(e);
    emit(e);
  };
  callLog.length = 0;
  telemetry.startTrace("rota proposal", { request });

  try {
    send({ t: "start", request, from: "Gráinne" });
    send({ t: "status", text: "ShiftGuard notes who's off" });
    const absences = await noteAbsences(request, baseWeek());
    for (const a of absences) send({ t: "noted", text: `${a.name.split(" ")[0]} can't work ${dayRange(a.dates, baseWeek().weekStart)}: ${a.reason}` });
    // From here on, the week carries those absences, so the availability rule holds every suggestion to them.
    const week = withAbsences(baseWeek(), absences);
    const assistant = new RotaAssistant(week);
    const hooks = { read: (tool: string) => send({ t: "read", tool, text: READ_WORDS[tool] ?? `The assistant reads ${tool}` }) };

    let proposalId = "";
    let passed = false;
    let round = 0;
    let proposal: Proposal | undefined;
    while (round < MAX_ROUNDS && !passed) {
      round++;
      send({ t: "status", text: round === 1 ? "The assistant works on a suggestion" : "The assistant tries again" });
      proposal = round === 1 ? await assistant.propose(request, hooks, `agent.round${round}`) : await assistant.revise(feedback(events, round - 1), hooks, `agent.round${round}`);

      let rota: Rota;
      try {
        rota = applyChange(toChange(proposal), week);
      } catch (err) {
        // A suggestion that names a shift or person that doesn't exist goes straight back.
        const message = err instanceof Error ? err.message : String(err);
        send({ t: "proposal", round, note: proposal.note, lines: [`(couldn't be read: ${message})`] });
        send({ t: "verdict", round, passed: false, proposalId: "", broken: [`The suggestion couldn't be applied: ${message}`] });
        continue;
      }
      send({ t: "proposal", round, note: proposal.note, lines: describe(week, rota) });

      send({ t: "status", text: "Gráinne's checks run on the suggestion" });
      const gate = await runGate(rota, (result) => {
        if (result.by === "judge" && !result.skipped) send({ t: "status", text: "The AI judge weighs what code can't decide" });
        send({ t: "check", round, result });
        telemetry.check({ agent: "rota", attempt: round, ruleId: result.ruleId, title: result.title, by: result.by, skipped: result.skipped === true, messages: result.violations.map((v) => v.message), ...(result.reason ? { reason: result.reason } : {}) });
      }, `judge.round${round}`);
      const broken = gate.results.filter((r) => r.violations.length);
      passed = gate.passed;
      proposalId = recordProposal({ request, round, note: proposal.note, rota, gate });
      send({ t: "verdict", round, passed, proposalId, broken: broken.map((b) => b.title) });
      telemetry.capture("shiftguard_gate_run", { agent: "rota", attempt: round, passed, broken_rules: broken.map((b) => b.ruleId), proposal_id: proposalId });
    }

    const runFile = `runs/propose-${started.toISOString().replace(/[:.]/g, "-")}.json`;
    const costUsd = callLog.reduce((s, c) => s + c.costUsd, 0);
    telemetry.capture("shiftguard_run", { agent: "rota", passed, tries: round, cost_usd: costUsd, claude_calls: callLog.length });
    await telemetry.endTrace({ passed, tries: round, proposalId, costUsd });
    send({ t: "done", passed, proposalId, rounds: round, costUsd, calls: [...callLog], runFile });
    const record: ProposeRecord = { started: started.toISOString(), events };
    mkdirSync("runs", { recursive: true });
    writeFileSync(runFile, JSON.stringify(record, null, 2));
    return record;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await telemetry.endTrace(undefined, message);
    send({ t: "error", message });
    throw err;
  }
}

/** What broke in a round, in the words the checks used, for the assistant's next try. */
function feedback(events: ProposeEvent[], round: number): string {
  const lines: string[] = [];
  for (const e of events) {
    if (e.t === "check" && e.round === round) for (const v of e.result.violations) lines.push(`- ${e.result.title}: ${v.message}`);
    if (e.t === "verdict" && e.round === round && !e.proposalId) lines.push(...e.broken.map((b) => `- ${b}`));
  }
  return lines.join("\n");
}
