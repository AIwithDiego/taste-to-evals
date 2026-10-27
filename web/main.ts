// The story, beat by beat. Each beat sets one big caption, moves things on the track, and (mostly) holds
// for the presenter. Events come from a saved run (Start) or the live engine (Start live).
import type { ChatEvent, ChatRecord, ProposeEvent, ProposeRecord, SetupEvent, SetupRecord } from "../src/events.js";
import type { RuleResult } from "../src/gate.js";
import type { Rota } from "../src/domain.js";
import {
  advance, approveReady, armRule, byId, caption, cardThinking, chapter, codeRuleIds, detail, el, hold, initStack, layout,
  lesson, lightNotebook, writeNote, markCard, moveCardTo, placeCard, resetGates, resetStage, rule, scanGate, sendBack, setRules,
  showCard, showReplyCard, stampDown, stationText, tech, typeInto, ui, wait, weigh, working, type HubRule,
} from "./stage.js";
import { Stream } from "./stream.js";

// What another builder can take away (the four points from the submitted proposal), shown at the moment each one happens.
const LESSONS = {
  ask: "Owners don't know their rules until something breaks. Ask about the bad week, not the rule.",
  examples: "Every rule ships with a passing and a failing example, or it isn't a rule yet.",
  order: "Code checks first. The AI judge goes last, and only for rules code can't decide. The screen says which is which.",
  write: "The AI that acts has no write tool. Only the approve step writes, and only after a passing run.",
  gate: "For an agent that talks to customers, the gate is the approval. Whatever can't pass goes to a person.",
} as const;

const setupEvents: SetupEvent[] = [];
const proposeEvents: ProposeEvent[] = [];
const chatEvents: ChatEvent[] = [];
let live = false;

/* ---------- small builders for the detail area ---------- */

function bubble(who: "owner" | "interviewer"): { node: HTMLElement; text: HTMLElement } {
  const node = el("div", `bubble ${who}`);
  node.append(el("span", "who", who === "owner" ? "Gráinne" : "ShiftGuard"));
  const text = el("div", "text");
  node.append(text);
  return { node, text };
}

/** First two sentences of her answer, enough to show where the note came from. */
function opening(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return parts.length > 220 ? `${parts.slice(0, 217).trimEnd()}...` : parts;
}

/** Plays the opening of a rule's saved interview: her story goes into the notes, then the rule lands on its gate. */
async function playStory(r: HubRule, box: HTMLElement, examples: "weeks" | "replies"): Promise<void> {
  box.replaceChildren();
  if (r.story) {
    const q = bubble("interviewer");
    q.text.textContent = r.story.ask;
    box.append(q.node);
    await wait(700);
    const a = bubble("owner");
    box.append(a.node);
    await typeInto(a.text, opening(r.story.answer), 150);
    writeNote(r.id);
    lightNotebook(r.id, true);
    await wait(800);
  }
  const out = el("p", "story-rule");
  out.append(el("span", "arrow", "→"), el("b", "", r.handwritten), el("small", "", `${r.by === "judge" ? "AI judge" : "Code"}${r.total ? ` · ${r.right} of ${r.total} of her ${examples} right` : ""}`));
  box.append(out);
  await armRule(r.id);
  await wait(500);
}

function tag(by: "code" | "judge"): HTMLElement {
  return el("span", `tag ${by === "judge" ? "ai" : "code"}`, by === "judge" ? "AI judge" : "Code");
}

function firstName(s: string): string {
  return s.replace(/\b(Kavanagh|Byrne|Walsh|Doyle|O'Connor|Murphy|Kelly)\b/g, "").replace(/\s+/g, " ").trim();
}

/* ---------- chapter 1: her rules ---------- */

async function chapterRules(setup: Stream<SetupEvent>): Promise<void> {
  chapter(1);
  caption("This is Gráinne. She runs Ollie's, a café off Grafton Street.", "She knows what a good week looks like. The AI that drafts her rota doesn't.");
  working("owner", true);
  tech([]);
  detail(el("p", "verdict-line", "Seven staff. Open 7am to 8pm, seven days. No rules written down. Just the weeks that went wrong."));
  await hold();

  caption("It doesn't ask for her rules. It asks what went wrong.", "Starting with hours.");
  lesson(LESSONS.ask);
  tech(["claude"], "Claude asks the questions. A second Claude plays Gráinne, answering only from her notes.");
  const chat = el("div", "chat");
  detail(chat);
  let e = await setup.next();
  while (e.t !== "rule") {
    setupEvents.push(e);
    if (e.t === "line") {
      const b = bubble(e.line.who);
      chat.append(b.node);
      while (chat.children.length > 2) chat.firstElementChild?.remove();
      await typeInto(b.text, e.line.text, e.line.who === "owner" ? 60 : 85);
      if (e.line.who === "owner") { writeNote("hours"); lightNotebook("hours", true); }
      await wait(450);
    }
    if (e.t === "error") throw new Error(e.message);
    e = await setup.next();
  }
  setupEvents.push(e);
  working("owner", false);
  await hold();

  const captured = e.rule;
  caption("Her words become a check.", "Claude writes it as code. Gráinne never has to read it.");
  tech(["claude", "ts"], "Claude writes the check as a TypeScript function, from her words.");
  const pair = el("div", "pair");
  const exact = el("div", "exact");
  exact.append(tag(captured.kind === "typed" ? "code" : "judge"), el("p", "", captured.precise));
  pair.append(el("p", "words", `“${captured.ownerWords}”`), el("span", "arrow", "→"), exact);
  detail(pair);
  await armRule("hours");
  await hold();

  caption("Before it guards anything, the check is tested on weeks she remembers.", "Her verdict on each week, against the check's.");
  lesson(LESSONS.examples);
  tech(["ts"], "The check runs in a sandbox: no files, no internet, one second at most.");
  const weeks = el("ol", "weeks");
  detail(weeks);
  const said = new Map<string, string>();
  let right = 0;
  let total = 0;
  let retried = false;
  for (e = await setup.next(); e.t !== "done" && e.t !== "error"; e = await setup.next()) {
    setupEvents.push(e);
    if (e.t === "examples") for (const w of e.weeks) said.set(w.id, w.said);
    if (e.t === "retry") retried = true;
    if (e.t === "outcome") {
      const o = e.outcome;
      total++;
      if (o.ok) right++;
      const li = el("li", `week ${!o.ok ? "wrong" : o.got === "pass" ? "pass" : "caught"}`);
      li.append(el("span", "", said.get(o.name) ?? e.short ?? o.name));
      li.append(el("span", "res", !o.ok ? "Got it wrong" : o.got === "pass" ? "✓ Fine, and the check agrees" : `✓ Caught: ${firstName(o.violations[0]?.message ?? "")}`));
      weeks.append(li);
      await wait(380);
    }
  }
  setupEvents.push(e);
  if (e.t === "error") throw new Error(e.message);
  caption("Before it guards anything, the check is tested on weeks she remembers.", `${right} of ${total} judged right.${retried ? " Claude's first try missed one; it fixed it before going live." : ""}`);
  ui.lesson.hidden = false;
  await hold();

  caption("Her other rules came out of the same interview.", "Recorded when she set them up. Her story, then the rule, tested on her weeks. Fair weekends goes to the AI judge.");
  tech(["claude", "ts"], "Same interview for each rule, saved at setup. Fair weekends becomes a written rubric for the judge instead of code.");
  const box = el("div", "chat");
  detail(box);
  for (const id of [...codeRuleIds().filter((x) => x !== "hours"), "fair"]) {
    const r = rule(id);
    if (r) await playStory(r, box, "weeks");
  }
  await hold();
}

/* ---------- chapters 2 to 4: the ask, the gate, her call ---------- */

async function chapterAsk(request: string): Promise<string> {
  chapter(2);
  resetStage();
  caption("Then Sarah calls in sick.", "Gráinne asks the AI to sort out the week.");
  tech([]);
  working("owner", true);
  const ask = el("div", "ask");
  const note = el("textarea");
  note.rows = 2;
  note.value = request;
  note.readOnly = !live;
  note.setAttribute("aria-label", "What Gráinne asks for");
  ask.append(note);
  detail(ask);
  await hold();
  working("owner", false);
  return note.value.trim() || request;
}

function caughtList(results: RuleResult[]): HTMLElement {
  const list = el("ul", "caught");
  // One line per broken rule first, so every rule that fired is visible; the rest fold into "and N more".
  const broken = results.filter((r) => !r.skipped && r.violations.length);
  const lines = broken.map((r) => ({ r, v: r.violations[0]! }));
  for (const r of broken) for (const v of r.violations.slice(1)) lines.push({ r, v });
  for (const { r, v } of lines.slice(0, 4)) {
    const li = el("li");
    li.append(el("small", "", rule(r.ruleId)?.handwritten ?? r.title), el("span", "", firstName(v.message)));
    list.append(li);
  }
  if (lines.length > 4) list.append(el("li", "more", `and ${lines.length - 4} more`));
  return list;
}

async function chapterGate(propose: Stream<ProposeEvent>): Promise<boolean> {
  let e = await propose.next();
  let round = 0;
  let results: RuleResult[] = [];
  const noted: string[] = [];
  while (e.t !== "done" && e.t !== "error") {
    proposeEvents.push(e);
    switch (e.t) {
      case "noted":
        noted.push(e.text);
        break;
      case "status":
        if (/assistant (works|tries)/.test(e.text)) {
          if (noted.length && round === 0) {
            caption("ShiftGuard notes the facts first.", noted.join(" · "));
            tech(["claude"], "Claude turns her message into facts the checks can hold the AI to.");
            detail(el("p", "noted", `Noted: ${noted.join(" · ")}`));
            await hold();
          }
          round++;
          chapter(2);
          resetGates();
          working("agent", true);
          placeCard(ui.agent.querySelector<HTMLElement>(".avatar") ?? ui.agent);
          showCard(round, []);
          cardThinking(true);
          caption(round === 1 ? "The AI drafts a new week." : "It tries again.", round === 1 ? "It can read the rota and the staff list. It has never seen her rules." : "It only knows what broke last time.");
          tech(["claude"], "Claude drafts the week. Its only tools read the rota and the staff list.");
          detail(el("p", "verdict-line", "Thinking…"));
        }
        break;
      case "proposal": {
        working("agent", false);
        cardThinking(false);
        showCard(e.round, e.lines);
        const s = el("div", "suggest");
        const lines = el("ul");
        for (const l of e.lines.slice(0, 6)) lines.append(el("li", "", l));
        if (e.lines.length > 6) lines.append(el("li", "", `and ${e.lines.length - 6} more changes`));
        s.append(el("p", "say", e.note), lines);
        detail(s);
        caption(e.round === 1 ? "The AI drafts a new week." : `Try ${e.round}.`, "Every change it suggests is on that card.");
        await hold();
        chapter(3);
        caption("It has to pass through her rules.", "Code checks first. The same answer every time.");
        if (e.round === 1) lesson(LESSONS.order);
        tech(["ts"], "Plain TypeScript, no AI: the same answer every time, in milliseconds.");
        results = [];
        detail(el("ul", "caught"));
        break;
      }
      case "check": {
        const r = e.result;
        results.push(r);
        if (r.by === "code") await scanGate(r.ruleId, r.violations.length);
        else if (r.skipped) {
          detail(caughtList(results));
        } else {
          caption("Code can't judge fairness. The AI judge weighs the weekends.", "It only gets asked once every code check has passed.");
          tech(["claude"], "Claude as the judge, scoring the week against the rubric from her interview.");
          detail(el("p", "verdict-line", "Weighing the weekends…"));
          await weigh(r.violations.length === 0);
          const line = el("p", "verdict-line");
          line.append(el("b", "", "AI judge: "), r.violations.length ? r.violations[0]?.message ?? "" : r.reason ?? "Fine.");
          detail(line);
          await hold();
        }
        break;
      }
      case "verdict":
        if (!e.passed) {
          const first = results.find((r) => r.violations.length)?.violations[0]?.message ?? e.broken[0] ?? "It broke a rule.";
          markCard("red", "Sent back");
          caption(`Sent back. ${firstName(first).split(/(?<=\.)\s/)[0]}`, "The AI only hears what broke. Never her rules.");
          detail(caughtList(results));
          await hold();
          await sendBack();
          resetGates();
        } else {
          markCard("green", "Passed");
          caption("Every rule kept.", e.round > 1 ? `It took ${e.round} tries. Each time, her rules held.` : "First try.");
          detail(el("p", "verdict-line", "Five code checks kept, and the AI judge says the weekends are fair."));
          await moveCardTo(ui.approve.querySelector<HTMLElement>(".desk") ?? ui.approve, 1100);
        }
        break;
      default:
        break;
    }
    e = await propose.next();
  }
  proposeEvents.push(e);
  if (e.t === "error") throw new Error(e.message);
  return e.passed;
}

async function chapterCall(): Promise<void> {
  const done = proposeEvents.find((x): x is Extract<ProposeEvent, { t: "done" }> => x.t === "done");
  if (!done) return;
  chapter(4);
  caption("Nothing is saved until Gráinne says so.", "The AI can't press this button. Only she can.");
  lesson(LESSONS.write);
  tech(["ts", "sqlite"], "Approve re-runs the code checks, then writes to SQLite. The only write anywhere in the system.");
  detail(el("p", "verdict-line", "Approving re-runs every code check one last time before anything is written."));
  approveReady(true);
  await new Promise<void>((resolve) => {
    ui.approveBtn.addEventListener("click", () => resolve(), { once: true });
    // Hands-free recording (?auto=1): Gráinne "presses" it after a pause.
    if (new URLSearchParams(location.search).get("auto") === "1") setTimeout(resolve, 3500);
  });
  approveReady(false);
  const res = await fetch("/api/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: done.proposalId }) });
  const result: { ok: boolean; message: string } = await res.json();
  if (!result.ok) {
    caption("Refused.", result.message);
    return;
  }
  stampDown();
  await wait(500);
  caption("Approved. Only now does the week change.", "The AI suggested. Her rules decided. She saved it.");
  tech(["posthog"], "Every Claude call, every check and her approval, traced in PostHog as it happened.");
  const fin = el("div", "final");
  // Rehearsals replay the same run, so it may already be approved; the closing line stays the same either way.
  fin.append(el("p", "big", "Approved by Gráinne. This is now the rota for the week."), el("p", "meter", `${done.rounds} tries · ${done.calls.length} calls to Claude · $${done.costUsd.toFixed(3)} for the whole run`));
  detail(fin);
  await hold();
  await showRecap(done.proposalId);
}

/* ---------- recap: the week she approved, and what happened ---------- */

interface ProposalView {
  rota: Rota;
  request: string;
  round: number;
  baseShiftIds: string[];
}

const KIND_LABEL = { open: "Open", mid: "Rush", close: "Close" } as const;

function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}` : String(hour);
}

function rosterTable(view: ProposalView): HTMLTableElement {
  const { rota } = view;
  const base = new Set(view.baseShiftIds);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${rota.weekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const t = el("table", "roster");
  const head = el("tr");
  head.append(el("th", "who", ""));
  for (const d of dates) head.append(el("th", "", new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", timeZone: "UTC" })));
  head.append(el("th", "hrs", "Hours"));
  t.append(head);
  for (const p of rota.staff) {
    const tr = el("tr");
    const who = el("td", "who", p.name.split(" ")[0] ?? p.name);
    who.append(el("small", "", p.trainedBarista ? "barista" : p.role));
    tr.append(who);
    let minutes = 0;
    for (const d of dates) {
      const shifts = rota.shifts.filter((x) => x.staffId === p.id && x.date === d);
      const off = p.unavailable.find((u) => u.date === d);
      if (shifts.length) {
        const sh = shifts[0]!;
        for (const x of shifts) {
          const [sh1 = 0, sm1 = 0] = x.start.split(":").map(Number);
          const [eh1 = 0, em1 = 0] = x.end.split(":").map(Number);
          minutes += eh1 * 60 + em1 - (sh1 * 60 + sm1);
        }
        const td = el("td", `shift ${sh.kind}${shifts.some((x) => !base.has(x.id)) ? " new" : ""}`);
        td.append(el("b", "", KIND_LABEL[sh.kind]), el("span", "", `${clock(sh.start)}–${clock(sh.end)}`));
        tr.append(td);
      } else if (off) {
        const td = el("td", "shift off", /sick|flu/i.test(off.reason) ? "Off sick" : "Can't work");
        td.title = off.reason;
        tr.append(td);
      } else {
        tr.append(el("td", "shift empty"));
      }
    }
    tr.append(el("td", `hrs${minutes >= 40 * 60 ? " full" : ""}`, String(minutes / 60)));
    t.append(tr);
  }
  return t;
}

function storyList(request: string): HTMLOListElement {
  const list = el("ol", "story");
  const ask = el("li");
  const askBody = el("div");
  askBody.append(el("b", "", "Gráinne asked: "), el("span", "quote", `“${request}”`));
  ask.append(askBody);
  list.append(ask);
  const noted = proposeEvents.filter((x): x is Extract<ProposeEvent, { t: "noted" }> => x.t === "noted").map((x) => x.text);
  if (noted.length) {
    const li = el("li");
    const body = el("div");
    body.append("ShiftGuard wrote it down as a fact: ", el("b", "", noted.map((t) => t.split(":")[0]).join("; ")), ". Every draft is held to it.");
    li.append(body);
    list.append(li);
  }
  for (const p of proposeEvents.filter((x): x is Extract<ProposeEvent, { t: "proposal" }> => x.t === "proposal")) {
    const checks = proposeEvents.filter((x): x is Extract<ProposeEvent, { t: "check" }> => x.t === "check" && x.round === p.round).map((x) => x.result);
    const broken = checks.filter((r) => r.violations.length);
    const li = el("li", broken.length ? "back" : "ok");
    const body = el("div");
    body.append(el("b", "", `Try ${p.round}: `), `the AI changed ${p.lines.length} shift${p.lines.length === 1 ? "" : "s"}. `);
    if (broken.length) {
      body.append("Her rules sent it back.");
      const why = broken.slice(0, 2).map((r) => firstName(r.violations[0]?.message ?? r.title).split(/(?<=\.)\s/)[0]).join(" ");
      body.append(el("span", "why", why));
    } else {
      body.append("Every rule kept.");
      const judged = checks.find((r) => r.by === "judge" && !r.skipped);
      if (judged?.reason) body.append(el("span", "why", `AI judge: ${judged.reason.split(/(?<=\.)\s/)[0]}`));
    }
    li.append(body);
    list.append(li);
  }
  const end = el("li", "ok");
  const endBody = el("div");
  endBody.append(el("b", "", "Gráinne approved it. "), "Only then was the week saved. The AI never could.");
  end.append(endBody);
  list.append(end);
  return list;
}

async function showRecap(proposalId: string): Promise<void> {
  const res = await fetch(`/api/proposal?id=${encodeURIComponent(proposalId)}`);
  if (!res.ok) return;
  const view: ProposalView = await res.json();
  caption("Here's the week she approved.", "What she asked, what her rules caught, and the week that came out of it.");
  tech(["sqlite"], "The approved week, read back from the SQLite store.");
  detail();
  const panel = el("section", "recap");
  panel.setAttribute("aria-label", "The approved week and what happened");
  const left = el("div");
  const legend = el("div", "legend");
  for (const [cls, label] of [["open", "Opening 6:30 to 2:30"], ["close", "Closing 12:30 to 8:30"], ["mid", "Saturday rush"], ["new", "Changed this week"]] as const) {
    const item = el("span");
    const sw = el("i");
    sw.style.background = cls === "open" ? "rgba(75,214,143,.35)" : cls === "close" ? "rgba(185,168,255,.35)" : cls === "mid" ? "rgba(242,180,65,.35)" : "transparent";
    if (cls === "new") sw.style.boxShadow = "inset 0 0 0 2px #f2b441";
    item.append(sw, label);
    legend.append(item);
  }
  const pack = el("a", "evidence-btn", "Evidence pack (PDF)");
  pack.href = `/evidence.pdf?id=${encodeURIComponent(proposalId)}`;
  pack.target = "_blank";
  left.append(el("h2", "", "The week of 26 October"), rosterTable(view), legend, pack);
  const right = el("div");
  right.append(el("h2", "", "What happened"), storyList(view.request));
  panel.append(left, right);
  document.body.append(panel);
  await hold();
  panel.remove();
}

/* ---------- takeaways: what another builder can use ---------- */

type Show = "rota" | "chat" | "both";

function showTakeaways(show: Show): void {
  caption("What another builder can take from this.", "Gráinne's café is the example. The pattern works for any agent that acts on someone else's business.");
  tech(["claude", "ts", "sqlite", "posthog"], "");
  const panel = el("section", "recap takeaways");
  panel.setAttribute("aria-label", "Takeaways for builders");
  const left = el("div");
  const list = el("ol");
  const lessons = show === "rota" ? [LESSONS.ask, LESSONS.examples, LESSONS.order, LESSONS.write]
    : show === "chat" ? [LESSONS.ask, LESSONS.examples, LESSONS.order, LESSONS.gate]
    : [LESSONS.ask, LESSONS.examples, LESSONS.order, LESSONS.write, LESSONS.gate];
  for (const text of lessons) list.append(el("li", "", text));
  left.append(el("h2", "", `${lessons.length === 5 ? "Five" : "Four"} things to steal`), list);
  const right = el("div");
  const dl = el("dl");
  const used: [string, string][] = [
    ["Claude Haiku 5.5", show === "rota"
      ? "Interviews Gráinne (a second Claude plays her), writes each check, turns her message into facts, drafts the rota, and judges the one rule code can't."
      : show === "chat"
        ? "Interviews Gráinne (a second Claude plays her), writes each check, drafts the chat replies, reads each reply for its promises, and judges her tone."
        : "Interviews Gráinne (a second Claude plays her), writes each check, drafts the rota and the chat replies, reads each reply for its promises, and judges the rules code can't."],
    ["TypeScript", "The checks Claude writes, type-checked and run in a sandbox, and the gate that runs them before any AI judge."],
    ["SQLite", show === "rota"
      ? "Every run stored on the laptop: request, each try, every check, the judge's reason, who approved. Approve is the only write."
      : show === "chat"
        ? "Every conversation stored on the laptop: each draft, every check, the judge's reason. Only a reply that just passed her checks gets written and sent."
        : "Every run stored on the laptop: each try, every check, the judge's reason. Only Approve, or a reply that just passed her checks, gets written."],
  ];
  used.push(["PostHog", "Every live run traced as it happens: each Claude call with its cost and time, each of her checks as a step in the same trace, and how often each rule catches something."]);
  for (const [name, what] of used) dl.append(el("dt", "", name), el("dd", "", what));
  right.append(el("h2", "", "Where the tech did its job"), dl);
  const again = el("button", "evidence-btn restart-btn", "Start again");
  again.type = "button";
  again.addEventListener("click", () => { location.href = `${location.pathname}?act=${show}`; });
  panel.append(left, right, el("p", "pattern", show === "both" ? "Same owner, same gate, two different agents. None of this needs our code: it's a pattern." : "None of this needs our code. It's a pattern for any agent that acts on someone else's business."), again);
  document.body.append(panel);
}


/* ---------- act two: her website chat ---------- */

interface ChatHubRule extends HubRule {
  right: number;
  total: number;
}

const CHAT_GATES = ["allergens", "discounts", "bookings"];

function convo(customer: string, reply?: { text: string; state: "draft" | "stopped" | "sent" }): HTMLElement {
  const box = el("div", "convo");
  const c = el("div", "bubble customer");
  c.append(el("span", "who", "Customer"), el("div", "text", customer));
  box.append(c);
  if (reply) {
    const b = el("div", `bubble bot ${reply.state}`);
    b.append(el("span", "who", reply.state === "sent" ? "Ollie's chat · sent" : reply.state === "stopped" ? "Stopped · never sent" : "Ollie's chat · draft, not sent"), el("div", "text", reply.text));
    box.append(b);
  }
  return box;
}

/** Played when the chat act stands alone: the bookings interview, the check tested on her replies, the other rules. */
async function chatSetupScene(setup: Stream<SetupEvent>, chatRules: ChatHubRule[]): Promise<void> {
  document.body.classList.add("rules-phase");
  caption("It doesn't ask for her rules. It asks what went wrong.", "Starting with bookings.");
  lesson(LESSONS.ask);
  tech(["claude"], "Claude asks the questions. A second Claude plays Gráinne, answering only from her notes.");
  working("owner", true);
  const chatBox = el("div", "chat");
  detail(chatBox);
  let e = await setup.next();
  while (e.t !== "rule") {
    if (e.t === "line") {
      const b = bubble(e.line.who);
      chatBox.append(b.node);
      while (chatBox.children.length > 2) chatBox.firstElementChild?.remove();
      await typeInto(b.text, e.line.text, e.line.who === "owner" ? 60 : 85);
      if (e.line.who === "owner") { writeNote("bookings"); lightNotebook("bookings", true); }
      await wait(450);
    }
    if (e.t === "error") throw new Error(e.message);
    if (e.t === "done") throw new Error("The interview ended without a rule.");
    e = await setup.next();
  }
  working("owner", false);
  await hold();

  const captured = e.rule;
  caption("Her words become a check.", "Claude writes it as code. Gráinne never has to read it.");
  tech(["claude", "ts"], "Claude writes the check as a TypeScript function, from her words.");
  const pair = el("div", "pair");
  const exact = el("div", "exact");
  exact.append(tag("code"), el("p", "", captured.precise));
  pair.append(el("p", "words", `“${captured.ownerWords}”`), el("span", "arrow", "→"), exact);
  detail(pair);
  await armRule("bookings");
  await hold();

  caption("Before it guards anything, the check is tested on replies she remembers.", "Her verdict on each reply, against the check's.");
  lesson(LESSONS.examples);
  tech(["ts"], "The check runs in a sandbox: no files, no internet, one second at most.");
  const replies = el("ol", "weeks");
  detail(replies);
  const asked = new Map<string, string>();
  let right = 0;
  let total = 0;
  for (e = await setup.next(); e.t !== "done" && e.t !== "error"; e = await setup.next()) {
    if (e.t === "examples") for (const w of e.weeks) asked.set(w.id, w.customer ? `“${w.customer}” ${w.verdict === "fine" ? "Fine." : "Not fine."}` : w.said);
    if (e.t === "outcome") {
      const o = e.outcome;
      total++;
      if (o.ok) right++;
      const li = el("li", `week ${!o.ok ? "wrong" : o.got === "pass" ? "pass" : "caught"}`);
      li.append(el("span", "", asked.get(o.name) ?? e.short ?? o.name));
      li.append(el("span", "res", !o.ok ? "Got it wrong" : o.got === "pass" ? "✓ Fine, and the check agrees" : `✓ Caught: ${(o.violations[0]?.message ?? "").split(/(?<=\.)\s/)[0]}`));
      replies.append(li);
      await wait(380);
    }
  }
  if (e.t === "error") throw new Error(e.message);
  caption("Before it guards anything, the check is tested on replies she remembers.", `${right} of ${total} judged right.`);
  ui.lesson.hidden = false;
  await hold();

  caption("Her other rules came out of the same interview.", "Recorded when she set them up. Her story, then the rule. Sounding like Ollie's goes to the AI judge.");
  tech(["claude", "ts"], "Same interview for each rule. Her tone becomes a written rubric for the judge instead of code.");
  const box = el("div", "chat");
  detail(box);
  for (const r of chatRules.filter((x) => x.id !== "bookings")) await playStory(r, box, "replies");
  await hold();
  document.body.classList.remove("rules-phase");
}

async function chapterChat(openChat: () => Stream<ChatEvent>, chatRules: ChatHubRule[], setup?: Stream<SetupEvent>): Promise<void> {
  const alone = setup !== undefined;
  chapter(5);
  document.body.dataset["act"] = "chat";
  resetStage();
  setRules(chatRules, CHAT_GATES);
  stationText("agent", "Website chat", "Can draft.<br>Can't send.");
  stationText("judge", "AI judge", "Listens for her tone");
  stationText("approve", "The customer");
  layout();
  placeCard(ui.agent.querySelector<HTMLElement>(".avatar") ?? ui.agent);
  caption(alone ? "This is Ollie's, a café in Dublin. Its website chat talks to customers." : "Same café. A different agent: her website chat.", "It answers on its own, straight away. Nobody checks it first.");
  tech([]);
  detail(el("p", "verdict-line", "Customers can't wait for Gráinne to approve every message. So her rules have to be the approval."));
  await hold();

  if (setup) await chatSetupScene(setup, chatRules);
  else {
    caption("She sets its rules the same way: what went wrong.", "The table for 14 at half seven. The 20% birthday discount. The banana bread.");
    tech(["claude", "ts"], "Same interview, same sandbox. Claude writes each check; her example replies prove it.");
    const list = el("ul", "stories");
    detail(list);
    for (const r of chatRules) {
      const li = el("li");
      li.append(el("small", "", r.total ? `${r.right} of ${r.total} of her replies right` : r.by === "judge" ? "AI judge" : "Code"), el("span", "", r.handwritten));
      list.append(li);
      await armRule(r.id);
    }
    await hold();
  }

  // Opened only now, so a live conversation never starts while a live interview is still running.
  const chat = openChat();
  let e = await chat.next();
  let customer = "";
  let draft = "";
  let results: RuleResult[] = [];
  let stopped = 0;
  while (e.t !== "done" && e.t !== "error") {
    chatEvents.push(e);
    switch (e.t) {
      case "customer":
        customer = e.text;
        resetGates();
        ui.card.classList.remove("shown");
        caption(e.turn === 1 ? "A customer writes in." : "She writes again.", e.turn === 1 ? "A mum, about her son." : "");
        tech([]);
        detail(convo(customer));
        await hold();
        break;
      case "status":
        if (/drafts|tries again/.test(e.text)) {
          working("agent", true);
          cardThinking(true);
        }
        break;
      case "draft":
        working("agent", false);
        cardThinking(false);
        resetGates();
        placeCard(ui.agent.querySelector<HTMLElement>(".avatar") ?? ui.agent);
        showReplyCard(e.attempt);
        draft = e.reply;
        caption(e.attempt === 1 ? "The chat drafts a reply." : "It tries again.", e.attempt === 1 ? "It knows the menu page. It has never seen her rules." : "It only knows what broke.");
        tech(["claude"], "Claude, set up like a typical FAQ bot: it answers from the menu page, and books tables.");
        detail(convo(customer, { text: draft, state: "draft" }));
        await hold();
        break;
      case "claims": {
        caption("Claude reads what the reply promises.", "Code can't read a sentence. It can check a promise.");
        tech(["claude"], "Claude only lists the promises. It doesn't judge them.");
        const ul = el("ul", "promises");
        if (e.lines.length) for (const l of e.lines) ul.append(el("li", "", l));
        else ul.append(el("li", "none", "It promises nothing risky."));
        detail(ul);
        await hold();
        caption("Her rules decide.", "Code checks first. The judge listens to the tone only if they pass.");
        tech(["ts"], "Plain TypeScript, no AI: the same promise gets the same answer every time.");
        results = [];
        detail(el("ul", "caught"));
        break;
      }
      case "check": {
        const r = e.result;
        results.push(r);
        if (r.by === "code") await scanGate(r.ruleId, r.violations.length);
        else if (!r.skipped) {
          tech(["claude"], "Claude as the judge, listening for the tone she described.");
          await weigh(r.violations.length === 0);
        }
        break;
      }
      case "verdict":
        if (!e.passed) {
          stopped++;
          markCard("red", "Stopped");
          caption("Stopped. The customer never sees it.", firstName(e.broken[0] ?? "It broke one of her rules.").split(/(?<=\.)\s/)[0] ?? "");
          detail(caughtList(results));
          await hold();
          await sendBack();
          resetGates();
        } else {
          markCard("green", "Sent");
          await moveCardTo(ui.approve.querySelector<HTMLElement>(".desk") ?? ui.approve, 1000);
        }
        break;
      case "sent":
        caption(e.attempts > 1 ? "Second try. Sent." : "Every rule kept. Sent.", e.attempts > 1 ? "The customer only ever sees the reply that passed." : "A careful answer goes straight out. The gate isn't there to block everything.");
        tech(["ts", "sqlite"], "ShiftGuard re-checks the promises, then delivers and stores the reply. The chat itself can't send.");
        detail(convo(customer, { text: e.reply, state: "sent" }));
        await hold();
        break;
      case "held":
        caption("Three tries and still breaking her rules. It goes to Gráinne.", "The customer gets a holding line instead.");
        detail(convo(customer, { text: e.holding, state: "sent" }));
        await hold();
        break;
      default:
        break;
    }
    e = await chat.next();
  }
  chatEvents.push(e);
  if (e.t === "error") throw new Error(e.message);
  caption("Nobody approved each message. Her rules did, in about a second.", "And three stopped drafts in a row would go to Gráinne instead.");
  lesson(LESSONS.gate);
  tech(["posthog"], "Every draft, every check and every reply sent, traced in PostHog as it happened.");
  const fin = el("div", "final");
  fin.append(el("p", "big", `${e.sent} ${e.sent === 1 ? "reply" : "replies"} sent · ${stopped} ${stopped === 1 ? "draft" : "drafts"} stopped before the customer saw ${stopped === 1 ? "it" : "them"}`), el("p", "meter", `${e.calls.length} calls to Claude · $${e.costUsd.toFixed(3)} for the conversation`));
  detail(fin);
  await hold();
}

/* ---------- running it ---------- */

/** Act two, the website chat: replayed from the latest saved conversation, or live. Skipped if there's none yet. */
/** Streams a live run from the engine, or replays a saved one. */
function stream<T extends { t: string }>(liveUrl: string, saved: () => Promise<{ events: T[] } | undefined>): Stream<T> {
  const out = new Stream<T>();
  if (live) {
    const src = new EventSource(liveUrl);
    src.onmessage = (m) => {
      const ev: T = JSON.parse(m.data);
      out.push(ev);
      if (ev.t === "done" || ev.t === "error") src.close();
    };
    src.onerror = () => {
      src.close();
      out.push({ t: "error", message: "Lost the connection to the engine." } as unknown as T);
    };
  } else {
    void saved().then((record) => {
      if (!record) out.push({ t: "error", message: "No saved run yet. Use Start live once." } as unknown as T);
      else for (const ev of record.events) out.push(ev);
    });
  }
  return out;
}

async function savedJson<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url);
  return res.ok ? ((await res.json()) as T) : undefined;
}

/** The website chat act. On its own it opens with the bookings interview; after the rota it takes the short way. */
async function playChat(alone = false): Promise<void> {
  const chatRules = await savedJson<ChatHubRule[]>("/api/chat/rules");
  if (!chatRules) return;
  const setup = alone ? stream<SetupEvent>("/api/chat/setup/live?rule=bookings", () => savedJson<SetupRecord>("/api/chat/setup/latest?rule=bookings")) : undefined;
  const openChat = () => stream<ChatEvent>("/api/chat/live", () => savedJson<ChatRecord>("/api/chat/latest"));
  await chapterChat(openChat, chatRules, setup);
}

async function run(mode: "replay" | "live", show: Show = picked()): Promise<void> {
  live = mode === "live";
  document.body.dataset["show"] = show;
  byId<HTMLDivElement>("titleCard").classList.add("gone");
  const rulesRes = await fetch("/api/rules");
  const rules: HubRule[] = await rulesRes.json();
  setRules(rules);
  initStack();
  layout();
  if (show === "chat") {
    try {
      await playChat(true);
      showTakeaways(show);
    } catch (err) {
      caption("Stopped.", err instanceof Error ? err.message : String(err));
    }
    return;
  }
  const setup = new Stream<SetupEvent>();
  const propose = new Stream<ProposeEvent>();
  let replayPropose: ProposeRecord | undefined;

  if (live) {
    const src = new EventSource("/api/setup/live?rule=hours");
    src.onmessage = (m) => {
      const ev: SetupEvent = JSON.parse(m.data);
      setup.push(ev);
      if (ev.t === "done" || ev.t === "error") src.close();
    };
    src.onerror = () => {
      src.close();
      setup.push({ t: "error", message: "Lost the connection to the engine." });
    };
  } else {
    const [s, p] = await Promise.all([fetch("/api/setup/latest?rule=hours"), fetch("/api/propose/latest")]);
    if (!s.ok || !p.ok) {
      caption("No saved run yet.", "Use Start live once to record one.");
      return;
    }
    const sr: SetupRecord = await s.json();
    for (const ev of sr.events) setup.push(ev);
    replayPropose = await p.json();
  }

  try {
    await chapterRules(setup);
    const defaultAsk = replayPropose?.events.find((x): x is Extract<ProposeEvent, { t: "start" }> => x.t === "start")?.request ?? "Sarah's got the flu and she's out all week. Tom says he'll take every extra shift going, he's saving for a deposit. Sort it out.";
    const request = await chapterAsk(defaultAsk);
    if (live) {
      const src = new EventSource(`/api/propose/live?request=${encodeURIComponent(request)}`);
      src.onmessage = (m) => {
        const ev: ProposeEvent = JSON.parse(m.data);
        propose.push(ev);
        if (ev.t === "done" || ev.t === "error") src.close();
      };
      src.onerror = () => {
        src.close();
        propose.push({ t: "error", message: "Lost the connection to the engine." });
      };
    } else if (replayPropose) {
      for (const ev of replayPropose.events) propose.push(ev);
    }
    const passed = await chapterGate(propose);
    byId<HTMLButtonElement>("inspectBtn").disabled = false;
    if (passed) await chapterCall();
    else {
      chapter(4);
      caption("No week passed her rules, so nothing changes.", "Nothing was saved. Gráinne decides what happens next.");
      await hold();
    }
    if (show === "both") await playChat();
    showTakeaways(show);
  } catch (err) {
    caption("Stopped.", err instanceof Error ? err.message : String(err));
  }
  byId<HTMLButtonElement>("inspectBtn").disabled = false;
}

/* ---------- technical detail ---------- */

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const s = el("section");
  s.append(el("h3", "", title), ...children);
  return s;
}

function table(headers: string[], rows: string[][], numeric: number[] = []): HTMLTableElement {
  const t = el("table");
  const head = el("tr");
  headers.forEach((h, i) => head.append(el("th", numeric.includes(i) ? "num" : "", h)));
  t.append(head);
  for (const r of rows) {
    const tr = el("tr");
    r.forEach((c, i) => tr.append(el("td", numeric.includes(i) ? "num" : "", c)));
    t.append(tr);
  }
  return t;
}

function callRows(calls: { step: string; model: string; inputTokens: number; outputTokens: number; ms: number; costUsd: number }[]): string[][] {
  return calls.map((c) => [c.step, c.model, String(c.inputTokens), String(c.outputTokens), (c.ms / 1000).toFixed(1), `$${c.costUsd.toFixed(4)}`]);
}

function openInspect(): void {
  const parts: HTMLElement[] = [];
  const rule = setupEvents.find((x): x is Extract<SetupEvent, { t: "rule" }> => x.t === "rule");
  const saved = setupEvents.find((x): x is Extract<SetupEvent, { t: "saved" }> => x.t === "saved");
  const sDone = setupEvents.find((x): x is Extract<SetupEvent, { t: "done" }> => x.t === "done");
  if (rule) parts.push(section("The hours rule, as captured in the interview", el("pre", "", JSON.stringify(rule.rule, null, 2))));
  if (saved) parts.push(section(`The check Claude wrote (${saved.file}). It runs in a sandbox: no files, no network, one-second limit.`, el("pre", "", saved.code)));
  const rounds = proposeEvents.filter((x): x is Extract<ProposeEvent, { t: "proposal" }> => x.t === "proposal");
  for (const p of rounds) {
    const checks = proposeEvents.filter((x): x is Extract<ProposeEvent, { t: "check" }> => x.t === "check" && x.round === p.round).map((x) => x.result);
    parts.push(section(`Try ${p.round}: what the AI suggested, and what each rule said`,
      el("pre", "", [p.note, "", ...p.lines.map((l) => `- ${l}`)].join("\n")),
      table(["Rule", "By", "Result", "Detail"], checks.map((r) => [r.title, r.by, r.skipped ? "not asked" : r.violations.length ? "broken" : "kept", r.skipped ? r.reason ?? "" : r.violations.map((v) => v.message).join(" ") || r.reason || ""])),
    ));
  }
  const pDone = proposeEvents.find((x): x is Extract<ProposeEvent, { t: "done" }> => x.t === "done");
  const calls = [...(sDone?.calls ?? []), ...(pDone?.calls ?? [])];
  if (calls.length) parts.push(section(`Every Claude call (${calls[0]?.model}) · records in ${[sDone?.runFile, pDone?.runFile].filter(Boolean).join(" and ")}`, table(["Step", "Model", "Tokens in", "Tokens out", "Seconds", "Cost"], callRows(calls), [2, 3, 4, 5])));
  parts.push(section("Safety", el("pre", "", "The AI has read-only tools (read_week, read_staff) and is never given her rules.\nOnly Approve writes a rota, and it re-runs every code check before writing.\nThe AI judge runs only after all code checks pass.")));
  parts.push(section("PostHog", el("p", "", "Live runs with telemetry on: each run is one trace in PostHog (LLM analytics, Traces), with every Claude call (cost, tokens, time) and each of her checks as a step. Events shiftguard_check and shiftguard_gate_run give failure rate by rule, code vs AI judge.")));
  byId<HTMLDivElement>("inspectBody").replaceChildren(...parts);
  byId<HTMLDialogElement>("inspect").showModal();
}

/* ---------- wiring ---------- */

/* Which demo the title card has selected: ?act=rota|chat|both preselects it. */
const pickButtons = [...document.querySelectorAll<HTMLButtonElement>("#pick [data-show]")];
function pick(show: string): void {
  for (const b of pickButtons) b.setAttribute("aria-checked", String(b.dataset["show"] === show));
}
function picked(): Show {
  const v = pickButtons.find((b) => b.getAttribute("aria-checked") === "true")?.dataset["show"];
  return v === "rota" || v === "chat" ? v : "both";
}
for (const b of pickButtons) b.addEventListener("click", () => pick(b.dataset["show"] ?? "both"));
const preset = new URLSearchParams(location.search).get("act");
if (preset === "rota" || preset === "chat" || preset === "both") pick(preset);

byId<HTMLButtonElement>("startReplay").addEventListener("click", () => void run("replay"));
byId<HTMLButtonElement>("startLive").addEventListener("click", () => void run("live"));
ui.next.addEventListener("click", advance);
byId<HTMLButtonElement>("inspectBtn").addEventListener("click", openInspect);
byId<HTMLButtonElement>("inspectClose").addEventListener("click", () => byId<HTMLDialogElement>("inspect").close());
document.addEventListener("keydown", (k) => {
  // On the title card, keys work the buttons normally (pick a demo, Start).
  if (!byId<HTMLDivElement>("titleCard").classList.contains("gone")) return;
  const typing = k.target instanceof HTMLTextAreaElement;
  if (typing && k.key !== "PageDown") return;
  if (["ArrowRight", " ", "PageDown", "Enter"].includes(k.key)) {
    k.preventDefault();
    advance();
  }
});
window.addEventListener("resize", () => layout());
if (new URLSearchParams(location.search).get("start") === "1") void run("replay");
