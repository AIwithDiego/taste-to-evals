// Everything that moves on screen: captions, the notebook, the gates, the travelling rota card, the judge, the stamp.

export const params = new URLSearchParams(location.search);
export const SPEED = Math.max(0.25, Number(params.get("speed") ?? 1) || 1);
export const AUTO = params.get("auto") === "1";
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, reducedMotion ? 0 : ms / SPEED));

/** Waits for an animation, but never longer than it should take: a paused or throttled tab must not freeze the story. */
async function settle(anim: Animation, ms: number): Promise<void> {
  await Promise.race([anim.finished.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, ms / SPEED + 250))]);
}

export function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export interface HubRule {
  id: string;
  handwritten: string;
  title: string | null;
  by: "code" | "judge";
  /** Opening of the saved interview for this rule: the question and her first answer. */
  story?: { ask: string; answer: string } | null;
  right?: number;
  total?: number;
}

export const ui = {
  track: byId<HTMLElement>("track"),
  rail: byId<HTMLDivElement>("rail"),
  caption: byId<HTMLHeadingElement>("caption"),
  sub: byId<HTMLParagraphElement>("subcaption"),
  chapters: byId<HTMLOListElement>("chapters"),
  notebook: byId<HTMLUListElement>("notebook"),
  gates: byId<HTMLDivElement>("gates"),
  owner: byId<HTMLDivElement>("stOwner"),
  agent: byId<HTMLDivElement>("stAgent"),
  judge: byId<HTMLDivElement>("stJudge"),
  approve: byId<HTMLDivElement>("stApprove"),
  approveBtn: byId<HTMLButtonElement>("approveBtn"),
  stamp: byId<HTMLSpanElement>("stamp"),
  card: byId<HTMLDivElement>("card"),
  cardRound: byId<HTMLElement>("cardRound"),
  cardGrid: byId<HTMLDivElement>("cardGrid"),
  cardMark: byId<HTMLDivElement>("cardMark"),
  detail: byId<HTMLElement>("detail"),
  hint: byId<HTMLParagraphElement>("hint"),
  next: byId<HTMLButtonElement>("nextBtn"),
  lesson: byId<HTMLParagraphElement>("lesson"),
  chips: byId<HTMLUListElement>("stackChips"),
  doing: byId<HTMLParagraphElement>("stackDoing"),
};

/* ---------- for builders: the lesson of the moment, and which tech is working ---------- */

export type Tech = "claude" | "ts" | "sqlite" | "posthog";
export const TECH: Record<Tech, string> = { claude: "Claude Haiku 5.5", ts: "TypeScript", sqlite: "SQLite", posthog: "PostHog" };

export function initStack(): void {
  ui.chips.replaceChildren(...(Object.keys(TECH) as Tech[]).map((id) => {
    const li = el("li", "", TECH[id]);
    li.dataset["tech"] = id;
    return li;
  }));
}

/** Lights the tech doing the work right now, with one plain line on what it's doing. */
export function tech(on: Tech[], doing = ""): void {
  for (const li of ui.chips.querySelectorAll<HTMLElement>("li")) li.classList.toggle("on", on.includes(li.dataset["tech"] as Tech));
  ui.doing.textContent = doing;
}

/** One lesson for builders under the caption. Cleared by the next caption. */
export function lesson(text: string): void {
  ui.lesson.replaceChildren(el("b", "", "For builders"), document.createTextNode(text));
  ui.lesson.hidden = false;
  ui.lesson.classList.remove("swap");
  void ui.lesson.offsetWidth;
  ui.lesson.classList.add("swap");
}

/* ---------- caption and chapters ---------- */

export function caption(main: string, sub = ""): void {
  ui.lesson.hidden = true;
  ui.caption.textContent = main;
  ui.sub.textContent = sub;
  for (const n of [ui.caption, ui.sub]) {
    n.classList.remove("swap");
    void n.offsetWidth;
    n.classList.add("swap");
  }
}

export function chapter(n: number): void {
  document.body.dataset["chapter"] = String(n);
  for (const li of ui.chapters.querySelectorAll<HTMLElement>("li")) {
    const c = Number(li.dataset["chapter"]);
    li.classList.toggle("active", c === n);
    li.classList.toggle("done", c < n);
  }
}

export function detail(...nodes: HTMLElement[]): void {
  ui.detail.replaceChildren(...nodes);
}

/* ---------- presenter pacing ---------- */

let release: (() => void) | undefined;

/** Holds the story until the presenter presses → / Space / Next (or, with ?auto=1, a few seconds pass). */
export function hold(ms = 3500): Promise<void> {
  if (params.get("debug") === "1") console.log(`HOLD ${Math.round(performance.now())} ${ui.caption.textContent}`);
  ui.hint.classList.add("show");
  ui.next.disabled = false;
  return new Promise((resolve) => {
    const done = () => {
      release = undefined;
      ui.hint.classList.remove("show");
      ui.next.disabled = true;
      resolve();
    };
    release = done;
    if (AUTO) setTimeout(() => release === done && done(), ms / SPEED);
  });
}

export function advance(): void {
  release?.();
}

/* ---------- Gráinne's notebook and the gates ---------- */

const ROTA_GATES = ["hours", "rest", "staffing", "barista", "availability"];

/** What her notebook holds before the interview: what went wrong, not rules. The rule only appears once it's captured. */
const MEMORIES: Record<string, string> = {
  hours: "Tom did 46 hours, dropped a tray",
  rest: "Liam closed, then opened. 10 hours",
  staffing: "Saturday rush, two of us. Queue walked",
  barista: "No barista on. Sold buns all morning",
  availability: "Aoife put on her college day",
  fair: "Chloe, four weekends running",
  bookings: "Chat booked 14 at half seven",
  allergens: "Chat said the banana bread had no nuts",
  discounts: "Chat promised 20% off. Eleven friends came",
  tone: "\"Dear valued customer\"",
};
let gateOrder = ROTA_GATES;
let rules: HubRule[] = [];

/** Puts her rules on the stage: the notebook, one gate per code rule (in this order), the judge for the rest. */
export function setRules(list: HubRule[], order: string[] = ROTA_GATES): void {
  rules = list;
  gateOrder = order;
  ui.notebook.replaceChildren(...list.map((r) => {
    // Unwritten until Gráinne tells that story: the notes fill in as the interview goes.
    const li = el("li", "unwritten", MEMORIES[r.id] ?? r.handwritten);
    li.dataset["rule"] = r.id;
    return li;
  }));
  ui.gates.style.gridTemplateColumns = `repeat(${order.length}, 1fr)`;
  ui.gates.replaceChildren(...order.map((id) => {
    const r = list.find((x) => x.id === id);
    const gate = el("div", "gate dormant");
    gate.dataset["gate"] = id;
    const arch = el("div", "arch");
    arch.append(el("span", "verdict"), el("span", "count"));
    // Blank until the interview produces the rule: nothing on stage before she says it.
    gate.append(arch, el("span", "label hand", ""));
    gate.title = r?.handwritten ?? id;
    return gate;
  }));
  ui.judge.classList.add("dormant");
  ui.judge.querySelector(".judge-rule")?.remove();
}

export function codeRuleIds(): string[] {
  return gateOrder;
}

/** Renames a station for the act on stage (the rota assistant becomes the website chat, and so on). */
export function stationText(station: "agent" | "judge" | "approve", name: string, role = ""): void {
  const st = ui[station];
  const h = st.querySelector("h2");
  if (h) h.textContent = name;
  const r = st.querySelector<HTMLElement>(".role");
  if (r) r.innerHTML = role;
}

export function rule(id: string): HubRule | undefined {
  return rules.find((r) => r.id === id);
}

function gateEl(id: string): HTMLElement | null {
  return ui.gates.querySelector<HTMLElement>(`[data-gate="${id}"]`);
}

/** Writes one of her stories into the notes, the moment she tells it. */
export function writeNote(id: string): void {
  const li = ui.notebook.querySelector(`[data-rule="${id}"]`);
  if (!li?.classList.contains("unwritten")) return;
  li.classList.remove("unwritten");
  li.classList.add("written");
}

export function lightNotebook(id: string, on: boolean): void {
  ui.notebook.querySelector(`[data-rule="${id}"]`)?.classList.toggle("lit", on);
}

/** Her handwritten rule flies from the notebook to its gate, which powers up. */
export async function armRule(id: string): Promise<void> {
  const from = ui.notebook.querySelector<HTMLElement>(`[data-rule="${id}"]`);
  if (from?.classList.contains("unwritten")) {
    writeNote(id);
    from.classList.add("lit");
    await wait(900);
  }
  const judged = rule(id)?.by === "judge";
  const target = judged ? ui.judge.querySelector<HTMLElement>("h2") : gateEl(id)?.querySelector<HTMLElement>(".label");
  if (from && target && !reducedMotion) {
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const flyer = el("div", "flyer", rule(id)?.handwritten ?? from.textContent ?? "");
    flyer.style.left = `${a.left}px`;
    flyer.style.top = `${a.top}px`;
    document.body.append(flyer);
    const dx = b.left + b.width / 2 - (a.left + flyer.offsetWidth / 2);
    const dy = b.top - a.top;
    await settle(flyer.animate(
      [{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${dx * 0.5}px, ${dy - 120}px) scale(1.15)`, opacity: 1, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(0.8)`, opacity: 0.2 }],
      { duration: 1100 / SPEED, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
    ), 1100);
    flyer.remove();
  }
  from?.classList.remove("lit");
  from?.classList.add("gone");
  if (judged) {
    // The judge shows the rule it weighs, the same way a gate shows its rule.
    const r = rule(id);
    let label = ui.judge.querySelector<HTMLElement>(".judge-rule");
    if (!label) {
      label = el("p", "judge-rule");
      ui.judge.append(label);
    }
    label.textContent = r?.handwritten ?? "";
    ui.judge.classList.remove("dormant");
    return;
  }
  const gate = gateEl(id);
  const r = rule(id);
  if (!gate || !r) return;
  const label = gate.querySelector<HTMLElement>(".label");
  if (label) {
    label.className = "label";
    label.textContent = r.handwritten;
  }
  gate.classList.remove("dormant");
  gate.classList.add("armed", "powering");
  setTimeout(() => gate.classList.remove("powering"), 1200);
}

export function resetGates(): void {
  for (const g of ui.gates.querySelectorAll<HTMLElement>(".gate")) {
    g.classList.remove("scanning", "pass", "fail");
    const c = g.querySelector(".count");
    if (c) c.textContent = "";
  }
  ui.judge.classList.remove("fine", "notfine", "working");
}

export async function scanGate(id: string, broken: number): Promise<void> {
  const g = gateEl(id);
  if (!g) return;
  await moveCardTo(g.querySelector<HTMLElement>(".arch") ?? g, 520);
  g.classList.add("scanning");
  await wait(750);
  g.classList.remove("scanning");
  g.classList.add(broken ? "fail" : "pass");
  const c = g.querySelector(".count");
  if (c && broken) c.textContent = String(broken);
  if (broken) ui.card.classList.add("red");
  await wait(broken ? 650 : 300);
}

/* ---------- stations ---------- */

export function working(station: "owner" | "agent" | "judge", on: boolean): void {
  ui[station].classList.toggle("working", on);
}

export async function weigh(fine: boolean): Promise<void> {
  await moveCardTo(ui.judge.querySelector<HTMLElement>(".avatar") ?? ui.judge, 600);
  ui.judge.classList.add("working");
  await wait(2200);
  ui.judge.classList.remove("working");
  ui.judge.classList.add(fine ? "fine" : "notfine");
  if (!fine) ui.card.classList.add("red");
}

/* ---------- the travelling rota card ---------- */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let cardX = 0;

function centreX(target: HTMLElement): number {
  const t = ui.track.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  return b.left + b.width / 2 - t.left - ui.card.offsetWidth / 2;
}

/** Lines the rail and the card up with the middle of the gates. */
export function layout(): void {
  const arch = ui.gates.querySelector<HTMLElement>(".arch");
  if (!arch) return;
  const t = ui.track.getBoundingClientRect();
  const a = arch.getBoundingClientRect();
  const y = a.top + a.height / 2 - t.top;
  ui.rail.style.top = `${y}px`;
  ui.card.style.top = `${y}px`;
  for (const st of [ui.owner, ui.agent, ui.judge, ui.approve]) {
    st.style.transform = "";
    const anchor = st.querySelector<HTMLElement>(".avatar, .desk");
    if (!anchor) continue;
    const r = anchor.getBoundingClientRect();
    st.style.transform = `translateY(${y - (r.top + r.height / 2 - t.top)}px)`;
  }
}

export function placeCard(at: HTMLElement): void {
  cardX = centreX(at);
  ui.card.getAnimations().forEach((a) => a.cancel());
  ui.card.style.transform = `translate(${cardX}px, -50%)`;
}

export async function moveCardTo(target: HTMLElement, ms = 900): Promise<void> {
  const x = centreX(target);
  ui.track.classList.add("moving");
  const anim = ui.card.animate([{ transform: `translate(${cardX}px, -50%)` }, { transform: `translate(${x}px, -50%)` }], { duration: ms / SPEED, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" });
  await settle(anim, ms);
  ui.card.style.transform = `translate(${x}px, -50%)`;
  anim.cancel();
  cardX = x;
  ui.track.classList.remove("moving");
}

/** Sent back: the card lifts off the track and arcs back to the assistant. */
export async function sendBack(): Promise<void> {
  const x = centreX(ui.agent.querySelector<HTMLElement>(".avatar") ?? ui.agent);
  const lift = Math.min(170, ui.track.clientHeight * 0.42);
  const anim = ui.card.animate(
    [
      { transform: `translate(${cardX}px, -50%)` },
      { transform: `translate(${cardX}px, calc(-50% - ${lift}px)) rotate(-4deg)`, offset: 0.25 },
      { transform: `translate(${x}px, calc(-50% - ${lift}px)) rotate(4deg)`, offset: 0.8 },
      { transform: `translate(${x}px, -50%)` },
    ],
    { duration: 1700 / SPEED, easing: "ease-in-out", fill: "forwards" },
  );
  await settle(anim, 1700);
  ui.card.style.transform = `translate(${x}px, -50%)`;
  anim.cancel();
  cardX = x;
}

/** The card as a draft chat reply instead of a week: a few lines of text, and its try number. */
export function showReplyCard(attempt: number): void {
  ui.card.classList.add("shown", "reply");
  ui.card.classList.remove("red", "green", "stamped");
  ui.cardMark.textContent = "";
  ui.cardRound.textContent = `Try ${attempt}`;
  const head = ui.card.querySelector(".card-head span");
  if (head) head.textContent = "Draft reply";
  ui.cardGrid.replaceChildren(el("span"), el("span"), el("span"));
}

export function showCard(round: number, lines: string[]): void {
  ui.card.classList.add("shown");
  ui.card.classList.remove("red", "green", "stamped", "reply");
  const head = ui.card.querySelector(".card-head span");
  if (head) head.textContent = "Week of 26 Oct";
  ui.cardMark.textContent = "";
  ui.cardRound.textContent = round ? `Try ${round}` : "";
  const changed = new Set(DAYS.filter((d) => lines.some((l) => l.includes(d))));
  ui.cardGrid.replaceChildren(...DAYS.map((d) => {
    const s = el("span", changed.has(d) ? "changed" : "");
    s.dataset["d"] = d.charAt(0);
    return s;
  }));
}

export function markCard(kind: "red" | "green", text: string): void {
  ui.card.classList.remove("red", "green");
  ui.card.classList.add(kind);
  ui.cardMark.textContent = text;
}

export function cardThinking(on: boolean): void {
  ui.card.classList.toggle("thinking", on);
}

/* ---------- approve ---------- */

export function approveReady(on: boolean): void {
  ui.approveBtn.disabled = !on;
  ui.approveBtn.classList.toggle("ready", on);
}

/** Her stamp lands on the card itself, and the desk lights up. */
export function stampDown(): void {
  ui.cardMark.textContent = "Approved";
  ui.card.classList.remove("red");
  ui.card.classList.add("green", "stamped");
  ui.approve.classList.add("done");
}

export function resetStage(): void {
  ui.card.classList.remove("shown", "red", "green", "thinking", "stamped", "reply");
  ui.stamp.classList.remove("down");
  ui.approve.classList.remove("done");
  approveReady(false);
  for (const s of [ui.owner, ui.agent, ui.judge]) s.classList.remove("working");
  resetGates();
}

export async function typeInto(target: HTMLElement, text: string, cps: number): Promise<void> {
  if (reducedMotion) {
    target.textContent = text;
    return;
  }
  target.classList.add("caret");
  const step = Math.max(1, Math.round(cps / 30));
  for (let i = 0; i <= text.length; i += step) {
    target.textContent = text.slice(0, i);
    await wait(1000 / 30);
  }
  target.textContent = text;
  target.classList.remove("caret");
}
