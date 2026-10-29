// Weeks the owner points at during the interview: "this one was fine, this one wasn't".
// Each is the normal week with a small change, so it's easy to see what changed and why.
import type { Rota, ShiftKind } from "./domain.js";
import { baseWeek, makeShift } from "./ollies.js";

export interface Change {
  /** Add a shift: who, which day (0 = Monday), which kind; optionally a different start/end. */
  add?: { staffId: string; day: number; kind: ShiftKind; start?: string; end?: string }[];
  /** Remove shifts by id. */
  remove?: string[];
  /** Replace the last four weeks' weekend counts (fairness examples only). */
  history?: Record<string, number>;
}

export interface Example {
  id: string;
  /** What the owner says about this week, in their words. */
  said: string;
  verdict: "fine" | "not fine";
  change: Change;
}

export function applyChange(change: Change, base: Rota = baseWeek()): Rota {
  const rota = structuredClone(base);
  const known = new Set(rota.shifts.map((s) => s.id));
  for (const id of change.remove ?? []) {
    if (!known.has(id)) throw new Error(`No shift "${id}" to remove`);
  }
  rota.shifts = rota.shifts.filter((s) => !(change.remove ?? []).includes(s.id));
  for (const a of change.add ?? []) {
    if (!rota.staff.some((p) => p.id === a.staffId)) throw new Error(`Unknown staff "${a.staffId}"`);
    if (a.day < 0 || a.day > 6) throw new Error(`Day ${a.day} is outside the week`);
    const shift = makeShift(a.staffId, a.day, a.kind);
    rota.shifts.push({
      ...shift,
      id: `${shift.id}-extra${rota.shifts.length}`,
      start: a.start ?? shift.start,
      end: a.end ?? shift.end,
    });
  }
  if (change.history) rota.weekendHistory = { ...rota.weekendHistory, ...change.history };
  return rota;
}

const MAX_HOURS: Example[] = [
  { id: "good-normal", verdict: "fine", said: "A normal week. Sarah, Tom and Liam on 40, everyone else under.", change: {} },
  {
    id: "good-chloe-40",
    verdict: "fine",
    said: "Chloe picked up an extra Monday shift and hit exactly 40. That's fine.",
    change: { add: [{ staffId: "chloe", day: 0, kind: "mid" }] },
  },
  {
    id: "good-swap",
    verdict: "fine",
    said: "Aoife and Darragh swapped a Sunday. Same hours, no problem.",
    change: { remove: ["2026-11-01-close-darragh"], add: [{ staffId: "aoife", day: 6, kind: "close" }] },
  },
  {
    id: "bad-tom-48",
    verdict: "not fine",
    said: "Tom covered an extra Monday opening on top of his week. 48 hours. Never again.",
    change: { add: [{ staffId: "tom", day: 0, kind: "open" }] },
  },
  {
    id: "bad-liam-40-5",
    verdict: "not fine",
    said: "Liam stayed on till 4 on the Saturday rush. Forty and a half. That's over.",
    change: { remove: ["2026-10-31-mid-liam"], add: [{ staffId: "liam", day: 5, kind: "mid", end: "16:00" }] },
  },
  {
    id: "bad-two-over",
    verdict: "not fine",
    said: "Both Sarah and Liam did an extra Saturday rush. Two people over in one week.",
    change: { add: [{ staffId: "sarah", day: 5, kind: "mid" }, { staffId: "liam", day: 6, kind: "mid" }] },
  },
];

const REST: Example[] = [
  { id: "good-normal", verdict: "fine", said: "A normal week. Nobody closes and then opens the next morning.", change: {} },
  {
    id: "good-darragh-11",
    verdict: "fine",
    said: "Darragh closed Tuesday and came in at half seven Wednesday. Exactly 11 hours. Fine.",
    change: { add: [{ staffId: "darragh", day: 2, kind: "mid" }] },
  },
  {
    id: "good-sarah-late",
    verdict: "fine",
    said: "Sarah swapped her Friday opening for the close. Plenty of rest either side.",
    change: { remove: ["2026-10-30-open-sarah"], add: [{ staffId: "sarah", day: 4, kind: "close" }] },
  },
  {
    id: "bad-niamh-clopen",
    verdict: "not fine",
    said: "Niamh closed Friday and opened Saturday. Ten hours. Never again.",
    change: { add: [{ staffId: "niamh", day: 5, kind: "open" }] },
  },
  {
    id: "bad-tom-clopen",
    verdict: "not fine",
    said: "Tom closed Thursday and we had him opening Friday.",
    change: { add: [{ staffId: "tom", day: 4, kind: "open" }] },
  },
  {
    id: "bad-darragh-10-5",
    verdict: "not fine",
    said: "Darragh closed Tuesday and came in at 7 Wednesday. Ten and a half. Not enough.",
    change: { add: [{ staffId: "darragh", day: 2, kind: "mid", start: "07:00", end: "15:00" }] },
  },
];

const STAFFING: Example[] = [
  { id: "good-normal", verdict: "fine", said: "A normal week. Two in all day, three on the Saturday rush.", change: {} },
  {
    id: "good-extra",
    verdict: "fine",
    said: "We put Chloe on an extra Wednesday shift. More hands is never a problem.",
    change: { add: [{ staffId: "chloe", day: 2, kind: "mid" }] },
  },
  {
    id: "good-swap",
    verdict: "fine",
    said: "Darragh did Aoife's Monday close instead. Still two of us.",
    change: { remove: ["2026-10-26-close-aoife"], add: [{ staffId: "darragh", day: 0, kind: "close" }] },
  },
  {
    id: "bad-sarah-alone",
    verdict: "not fine",
    said: "Liam was off Monday morning and nobody covered. Sarah on her own till half twelve.",
    change: { remove: ["2026-10-26-open-liam"] },
  },
  {
    id: "bad-saturday-two",
    verdict: "not fine",
    said: "No rush shift that Saturday. Two of us for the busiest morning of the week.",
    change: { remove: ["2026-10-31-mid-liam"] },
  },
  {
    id: "bad-chloe-early",
    verdict: "not fine",
    said: "Chloe left at 7 on Sunday. Darragh on his own for the last hour.",
    change: { remove: ["2026-11-01-close-chloe"], add: [{ staffId: "chloe", day: 6, kind: "close", end: "19:00" }] },
  },
];

const BARISTA: Example[] = [
  { id: "good-normal", verdict: "fine", said: "A normal week. Someone on the machine every hour we're open.", change: {} },
  {
    id: "good-niamh-for-sarah",
    verdict: "fine",
    said: "Niamh did Sarah's Monday opening. Both trained, no problem.",
    change: { remove: ["2026-10-26-open-sarah"], add: [{ staffId: "niamh", day: 0, kind: "open" }] },
  },
  {
    id: "good-extra-floor",
    verdict: "fine",
    said: "Aoife did an extra Wednesday shift. She's not on the machine but the others were.",
    change: { add: [{ staffId: "aoife", day: 2, kind: "mid" }] },
  },
  {
    id: "bad-monday-morning",
    verdict: "not fine",
    said: "Darragh covered Sarah's Monday opening. Him and Liam, nobody on the machine all morning.",
    change: { remove: ["2026-10-26-open-sarah"], add: [{ staffId: "darragh", day: 0, kind: "open" }] },
  },
  {
    id: "bad-sunday-close",
    verdict: "not fine",
    said: "Aoife took Chloe's Sunday close. Her and Darragh, no barista all evening.",
    change: { remove: ["2026-11-01-close-chloe"], add: [{ staffId: "aoife", day: 6, kind: "close" }] },
  },
  {
    id: "bad-tom-early",
    verdict: "not fine",
    said: "Tom left at half seven Monday. Aoife on her own, no coffee for the last half hour.",
    change: { remove: ["2026-10-26-close-tom"], add: [{ staffId: "tom", day: 0, kind: "close", end: "19:30" }] },
  },
];

const AVAILABILITY: Example[] = [
  { id: "good-normal", verdict: "fine", said: "A normal week. Aoife off Tuesday, Darragh off for the dentist.", change: {} },
  {
    id: "good-aoife-wed",
    verdict: "fine",
    said: "Aoife picked up a Wednesday. She's free Wednesdays.",
    change: { add: [{ staffId: "aoife", day: 2, kind: "mid" }] },
  },
  {
    id: "good-darragh-fri",
    verdict: "fine",
    said: "Darragh did Aoife's Friday opening. He's only off Thursday.",
    change: { remove: ["2026-10-30-open-aoife"], add: [{ staffId: "darragh", day: 4, kind: "open" }] },
  },
  {
    id: "bad-aoife-tuesday",
    verdict: "not fine",
    said: "Someone put Aoife on Tuesday. She has college.",
    change: { add: [{ staffId: "aoife", day: 1, kind: "close" }] },
  },
  {
    id: "bad-aoife-short",
    verdict: "not fine",
    said: "Just a couple of hours Tuesday morning for Aoife. Still no. She told us.",
    change: { add: [{ staffId: "aoife", day: 1, kind: "open", end: "09:00" }] },
  },
  {
    id: "bad-darragh-dentist",
    verdict: "not fine",
    said: "Darragh was on Thursday, the day of his dentist.",
    change: { add: [{ staffId: "darragh", day: 3, kind: "close" }] },
  },
];

// Normal week: Chloe, Liam, Darragh (lighter month, 3 of 8) on both days; Tom, Aoife, Niamh (4 of 8) one day; Sarah none (asked).
export const FAIR_EXAMPLES: Example[] = [
  { id: "good-normal", verdict: "fine", said: "A normal week. Everyone who wants weekends gets some, Sarah's off them like she asked.", change: {} },
  {
    id: "good-swap",
    verdict: "fine",
    said: "Niamh took Chloe's Sunday close. Spreads it out a bit more.",
    change: { remove: ["2026-11-01-close-chloe"], add: [{ staffId: "niamh", day: 6, kind: "close" }] },
  },
  {
    id: "good-aoife-rush",
    verdict: "fine",
    said: "Aoife did Liam's Saturday rush. She'd asked for more weekend hours.",
    change: { remove: ["2026-10-31-mid-liam"], add: [{ staffId: "aoife", day: 5, kind: "mid" }] },
  },
  {
    id: "bad-chloe-again",
    verdict: "not fine",
    said: "Chloe had done every weekend shift going for a month and we gave her both days again.",
    change: { history: { chloe: 8, tom: 1, niamh: 1 } },
  },
  {
    id: "bad-sarah-sunday",
    verdict: "not fine",
    said: "We put Sarah on a Sunday. She asked for weekends off till Christmas, she's minding her mam.",
    change: { remove: ["2026-11-01-open-niamh"], add: [{ staffId: "sarah", day: 6, kind: "open" }] },
  },
  {
    id: "bad-same-three",
    verdict: "not fine",
    said: "Chloe, Liam and Darragh on both days again. They've carried every weekend this month while the others had one.",
    change: { history: { chloe: 8, liam: 8, darragh: 8, tom: 1, niamh: 1, aoife: 1 } },
  },
];

export const EXAMPLES = { hours: MAX_HOURS, rest: REST, staffing: STAFFING, barista: BARISTA, availability: AVAILABILITY } as const;
/** Kept for the hours rule's tests. */
export const MAX_HOURS_EXAMPLES = MAX_HOURS;
