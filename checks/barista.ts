// Written by Claude from the interview on 2026-10-20. Rule: Coffee machine cover, every open hour
import type { Role, Rota, Shift, ShiftKind, Staff, Violation } from "../src/domain.js";

export function check(rota: Rota): Violation[] {
  const DAY_NAMES: string[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const OPEN_MIN = 420;
  const CLOSE_MIN = 1200;
  const DAY_MS = 86400000;
  const base = Date.parse(rota.weekStart + "T00:00:00Z");
  if (!Number.isFinite(base)) return [];
  const trained = new Set<string>();
  for (const s of rota.staff) {
    if (s.trainedBarista) trained.add(s.id);
  }
  function parseMin(t: string): number {
    const parts = t.split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return h * 60 + m;
  }
  function fmtTime(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const suffix = h >= 12 ? "pm" : "am";
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    if (m === 0) return String(h12) + suffix;
    return String(h12) + ":" + (m < 10 ? "0" : "") + String(m) + suffix;
  }
  function fmtLength(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return mins === 30 ? "half an hour" : String(mins) + " minutes";
    const hp = h === 1 ? "1 hour" : String(h) + " hours";
    if (m === 0) return hp;
    return hp + " and " + String(m) + " minutes";
  }
  const violations: Violation[] = [];
  for (let d = 0; d < 7; d++) {
    const dateStr = new Date(base + d * DAY_MS).toISOString().slice(0, 10);
    const dayName = DAY_NAMES[d] ?? "that day";
    const covered: boolean[] = new Array(1440).fill(false);
    for (const s of rota.shifts) {
      if (s.date !== dateStr || !trained.has(s.staffId)) continue;
      const a = parseMin(s.start);
      const b = parseMin(s.end);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      for (let t = Math.max(0, a); t < Math.min(1440, b); t++) covered[t] = true;
    }
    let m = OPEN_MIN;
    while (m < CLOSE_MIN) {
      if (covered[m]) {
        m++;
        continue;
      }
      let end = m;
      while (end < CLOSE_MIN && !covered[end]) end++;
      violations.push({
        date: dateStr,
        message:
          "Nobody trained on the coffee machine is on from " +
          fmtTime(m) +
          " to " +
          fmtTime(end) +
          " on " +
          dayName +
          ". That leaves " +
          fmtLength(end - m) +
          " with no one trained on the machine.",
      });
      m = end;
    }
  }
  return violations;
}
