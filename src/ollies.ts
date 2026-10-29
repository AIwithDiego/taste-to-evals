// Ollie's, an invented café in Dublin 2. A normal week that keeps every one of the owner's rules.
import { readFileSync } from "node:fs";
import type { Rota, Shift, ShiftKind, Staff } from "./domain.js";

export const WEEK_START = "2026-10-26"; // Monday

const SLOTS: Record<ShiftKind, { start: string; end: string }> = {
  open: { start: "06:30", end: "14:30" },
  mid: { start: "07:30", end: "15:30" },
  close: { start: "12:30", end: "20:30" },
};

// day index (0 = Monday) -> who opens, who works the Saturday rush, who closes
const WEEK: { open: string[]; mid?: string[]; close: string[] }[] = [
  { open: ["sarah", "liam"], close: ["tom", "aoife"] },
  { open: ["sarah", "liam"], close: ["tom", "darragh"] },
  { open: ["sarah", "niamh"], close: ["tom", "chloe"] },
  { open: ["sarah", "liam"], close: ["tom", "niamh"] },
  { open: ["sarah", "aoife"], close: ["chloe", "niamh"] },
  { open: ["tom", "aoife"], mid: ["liam"], close: ["chloe", "darragh"] },
  { open: ["niamh", "liam"], close: ["chloe", "darragh"] },
];

export function dateOf(dayIndex: number): string {
  const d = new Date(`${WEEK_START}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}

export function makeShift(staffId: string, dayIndex: number, kind: ShiftKind): Shift {
  const date = dateOf(dayIndex);
  return { id: `${date}-${kind}-${staffId}`, staffId, date, kind, ...SLOTS[kind] };
}

export function loadStaff(): Staff[] {
  return JSON.parse(readFileSync(new URL("../data/ollies/staff.json", import.meta.url), "utf8"));
}

export function loadHistory(): Record<string, number> {
  return JSON.parse(readFileSync(new URL("../data/ollies/weekend-history.json", import.meta.url), "utf8"));
}

export function baseWeek(): Rota {
  const shifts: Shift[] = [];
  WEEK.forEach((day, i) => {
    for (const kind of ["open", "mid", "close"] as const) {
      for (const id of day[kind] ?? []) shifts.push(makeShift(id, i, kind));
    }
  });
  return { cafe: "Ollie's, Dublin 2", weekStart: WEEK_START, staff: loadStaff(), shifts, weekendHistory: loadHistory() };
}
