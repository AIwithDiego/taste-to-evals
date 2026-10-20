// Hand-written reference rules. Test-only: used to prove the owner's example weeks are labelled right,
// and to cross-check that the checks Claude wrote aren't more lenient than the rules.
import { shiftHours, toMinutes, type Rota } from "./domain.js";
import type { EXAMPLES } from "./examples.js";

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00Z`).getTime() / 60000;

export const reference: Record<keyof typeof EXAMPLES, (r: Rota) => boolean> = {
  hours: (r) => {
    const h = new Map<string, number>();
    for (const s of r.shifts) h.set(s.staffId, (h.get(s.staffId) ?? 0) + shiftHours(s));
    return [...h.values()].every((x) => x <= 40);
  },
  rest: (r) => {
    for (const p of r.staff) {
      const mine = r.shifts.filter((s) => s.staffId === p.id).sort((a, b) => at(a.date, a.start) - at(b.date, b.start));
      for (let i = 1; i < mine.length; i++) {
        const prev = mine[i - 1]!, cur = mine[i]!;
        if (at(cur.date, cur.start) - at(prev.date, prev.end) < 11 * 60) return false;
      }
    }
    return true;
  },
  staffing: (r) => coverage(r, (count) => count),
  barista: (r) => {
    const trained = new Set(r.staff.filter((p) => p.trainedBarista).map((p) => p.id));
    return everyMinuteOpen(r, (date, m) => r.shifts.some((s) => s.date === date && trained.has(s.staffId) && toMinutes(s.start) <= m && m < toMinutes(s.end)));
  },
  availability: (r) => r.shifts.every((s) => !r.staff.find((p) => p.id === s.staffId)?.unavailable.some((u) => u.date === s.date)),
};

function dates(r: Rota): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${r.weekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function everyMinuteOpen(r: Rota, ok: (date: string, minute: number) => boolean): boolean {
  for (const date of dates(r)) for (let m = 7 * 60; m < 20 * 60; m += 15) if (!ok(date, m)) return false;
  return true;
}

function coverage(r: Rota, _: (n: number) => number): boolean {
  return everyMinuteOpen(r, (date, m) => {
    const n = r.shifts.filter((s) => s.date === date && toMinutes(s.start) <= m && m < toMinutes(s.end)).length;
    const saturdayRush = new Date(`${date}T12:00:00Z`).getUTCDay() === 6 && m >= 8 * 60 && m < 12 * 60;
    return n >= (saturdayRush ? 3 : 2);
  });
}

