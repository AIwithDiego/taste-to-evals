// The evidence pack: one page per rota run, for an insurer or an EU AI Act auditor. What was asked, every try
// the AI made, every check and what it caught, the judge's reason, who approved it and when, what it cost.
// Built only from the saved run and the store; nothing here calls Claude or writes anything.
import { existsSync, readFileSync } from "node:fs";
import type { ProposeEvent, ProposeRecord, SetupRecord } from "./events.js";
import { RULES } from "./rules.js";
import { approvalOf } from "./store.js";
import { savedRuns } from "./runs.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** Finds the saved run whose final proposal is this one. */
export function runFor(proposalId: string): { file: string; record: ProposeRecord } | undefined {
  for (const { path } of savedRuns("propose-")) {
    const record: ProposeRecord = JSON.parse(readFileSync(path, "utf8"));
    if (record.events.some((e) => e.t === "done" && e.proposalId === proposalId)) return { file: path, record };
  }
  return undefined;
}

function proven(ruleId: string): string {
  const last = savedRuns(`setup-${ruleId}-`)[0];
  if (!last) return "not set up";
  const outcomes = (JSON.parse(readFileSync(last.path, "utf8")) as SetupRecord).events.filter((e) => e.t === "outcome");
  return `${outcomes.filter((e) => e.t === "outcome" && e.outcome.ok).length} of ${outcomes.length}`;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Dublin" });

export function evidenceHtml(proposalId: string): string | undefined {
  const run = runFor(proposalId);
  if (!run) return undefined;
  const ev = run.record.events;
  const start = ev.find((e): e is Extract<ProposeEvent, { t: "start" }> => e.t === "start");
  const done = ev.find((e): e is Extract<ProposeEvent, { t: "done" }> => e.t === "done");
  const noted = ev.filter((e): e is Extract<ProposeEvent, { t: "noted" }> => e.t === "noted").map((e) => e.text);
  const approval = approvalOf(proposalId);
  const tries = ev.filter((e): e is Extract<ProposeEvent, { t: "proposal" }> => e.t === "proposal").map((p) => {
    const checks = ev.filter((e): e is Extract<ProposeEvent, { t: "check" }> => e.t === "check" && e.round === p.round).map((e) => e.result);
    const verdict = ev.find((e): e is Extract<ProposeEvent, { t: "verdict" }> => e.t === "verdict" && e.round === p.round);
    return { round: p.round, note: p.note, changes: p.lines.length, checks, passed: verdict?.passed ?? false };
  });
  const rules = RULES.map((r) => {
    const file = `checks/${r.id}.rule.json`;
    const spec = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    return { id: r.id, title: spec?.title ?? r.handwritten, words: spec?.ownerWords ?? "", by: r.kind === "judged" ? "AI judge" : "Code", proven: proven(r.id) };
  });
  const cell = (r: { violations: { message: string }[]; skipped?: boolean; reason?: string; by: string }) =>
    r.skipped ? `<span class="skip">Not asked: code failed first</span>`
      : r.violations.length ? `<span class="bad">Broken: ${esc(r.violations[0]?.message)}${r.violations.length > 1 ? ` (+${r.violations.length - 1} more)` : ""}</span>`
        : `<span class="ok">Kept${r.by === "judge" && r.reason ? `: ${esc(r.reason.split(/(?<=\.)\s/)[0])}` : ""}</span>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Evidence pack ${esc(proposalId)}</title>
<style>
  @page { size: A4; margin: 10mm 11mm; }
  @font-face { font-family: "Atkinson Hyperlegible"; font-weight: 400; src: url("/fonts/atkinson-400.woff2") format("woff2"); }
  @font-face { font-family: "Atkinson Hyperlegible"; font-weight: 700; src: url("/fonts/atkinson-700.woff2") format("woff2"); }
  body { font: 8.1pt/1.3 "Atkinson Hyperlegible", system-ui, sans-serif; color: #10231b; margin: 0; }
  h1 { font-size: 15pt; margin: 0; } h2 { font-size: 9.2pt; margin: 7pt 0 2pt; color: #1d6b48; border-bottom: 1px solid #cfe0d6; padding-bottom: 1.5pt; }
  .meta { color: #4b6458; margin: 2pt 0 0; } .top { display: flex; justify-content: space-between; align-items: end; border-bottom: 2px solid #1d6b48; padding-bottom: 5pt; }
  .stamp { font-weight: 700; font-size: 10pt; padding: 3pt 8pt; border: 2px solid; border-radius: 4pt; }
  .stamp.yes { color: #12804a; } .stamp.no { color: #b3261e; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 2pt 4pt; border-bottom: 1px solid #e3ece6; }
  th { font-size: 7.6pt; color: #4b6458; font-weight: 700; } .ok { color: #12804a; } .bad { color: #b3261e; } .skip { color: #7a8a82; }
  .quote { font-size: 10pt; } ul { margin: 0; padding-left: 12pt; } p { margin: 0 0 3pt; }
  .foot { margin-top: 8pt; color: #4b6458; font-size: 7.6pt; border-top: 1px solid #cfe0d6; padding-top: 4pt; }
</style></head><body>
<div class="top"><div><h1>ShiftGuard evidence pack</h1><p class="meta">Ollie's, Dublin 2 · rota for the week of 26 October 2026 · run ${esc(proposalId)} · ${esc(when(run.record.started))}</p></div>
<span class="stamp ${approval ? "yes" : "no"}">${approval ? "Approved by a person" : done?.passed ? "Passed, not yet approved" : "Not approved"}</span></div>

<h2>What was asked</h2>
<p class="quote">“${esc(start?.request)}” (from ${esc(start?.from)})</p>
${noted.length ? `<p>Noted as facts before the AI started: ${noted.map(esc).join("; ")}.</p>` : ""}

<h2>Every try the AI made, and what her rules said</h2>
<table><tr><th style="width:9%">Try</th>${rules.map((r) => `<th>${esc(r.title)} <span class="skip">(${r.by})</span></th>`).join("")}</tr>
${tries.map((t) => `<tr><td><b>${t.round}</b><br>${t.changes} changes<br>${t.passed ? '<span class="ok">Passed</span>' : '<span class="bad">Sent back</span>'}</td>${rules.map((r) => {
    const result = t.checks.find((c) => c.ruleId === r.id);
    return `<td>${result ? cell(result) : '<span class="skip">Not run</span>'}</td>`;
  }).join("")}</tr>`).join("")}
</table>

<h2>Approval</h2>
${approval ? `<p><b>${esc(approval.by)}</b> approved try ${tries.at(-1)?.round ?? ""} on ${esc(when(approval.at))}. Approving re-ran every code check before anything was written; the AI judge's verdict was taken from the gate run.</p>` : `<p>No one has approved this run. Nothing was written to the rota.</p>`}

<h2>The rules in force, and how each was proven before it guarded anything</h2>
<table><tr><th>Rule</th><th>In her words</th><th>Checked by</th><th>Right on her examples</th></tr>
${rules.map((r) => `<tr><td><b>${esc(r.title)}</b></td><td>${esc(r.words)}</td><td>${r.by}</td><td>${esc(r.proven)}</td></tr>`).join("")}
</table>

<h2>Controls</h2>
<p>The AI that drafts the rota has read-only tools and is never given the owner's rules; it only hears what broke. Each code check was written by Claude from the owner's interview, type-checked and run in a sandbox (no file, network or system access, one-second limit). Code checks run first; the AI judge is asked only once they all pass, and is labelled as AI. Only the owner's Approve writes a rota, and it re-runs the code checks before writing.</p>

<p class="foot">Model: Claude Haiku 5.5 · ${done?.calls.length ?? 0} calls · $${(done?.costUsd ?? 0).toFixed(3)} for the run · record: ${esc(run.file)} · synthetic data (Ollie's is an invented café) · generated ${esc(when(new Date().toISOString()))}</p>
</body></html>`;
}
