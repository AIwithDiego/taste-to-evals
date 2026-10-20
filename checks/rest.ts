// Written by Claude from the interview on 2026-10-20. Rule: Minimum 11 hours between shifts
import type { Role, Rota, Shift, ShiftKind, Staff, Violation } from "../src/domain.js";

export function check(rota: Rota): Violation[] {
  const MIN_REST = 660;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const out: Violation[] = [];
  const nameOf = new Map<string, string>();
  for (const s of rota.staff) {
    nameOf.set(s.id, s.name);
  }
  function clock(hhmm: string): number {
    const parts = hhmm.split(":");
    const h = Number(parts[0] ?? 0);
    const m = Number(parts[1] ?? 0);
    return h * 60 + m;
  }
  function dayNo(date: string): number {
    return Math.round(Date.parse(date + "T00:00:00Z") / 86400000);
  }
  function startAbs(s: Shift): number {
    return dayNo(s.date) * 1440 + clock(s.start);
  }
  function endAbs(s: Shift): number {
    return dayNo(s.date) * 1440 + clock(s.end);
  }
  function dayName(date: string): string {
    const d = new Date(date + "T00:00:00Z").getUTCDay();
    return DAYS[d] ?? date;
  }
  function hoursText(mins: number): string {
    const h = Math.floor(mins / 60);
    const r = mins - h * 60;
    if (r === 0) return h === 1 ? "1 hour" : h + " hours";
    if (r === 30) return h === 0 ? "half an hour" : h + " and a half hours";
    const rest = r === 1 ? "1 minute" : r + " minutes";
    if (h === 0) return rest;
    if (h === 1) return "1 hour and " + rest;
    return h + " hours and " + rest;
  }
  const byStaff = new Map<string, Shift[]>();
  for (const sh of rota.shifts) {
    const list = byStaff.get(sh.staffId);
    if (list) {
      list.push(sh);
    } else {
      byStaff.set(sh.staffId, [sh]);
    }
  }
  byStaff.forEach(function (list, staffId) {
    const sorted = list.slice().sort(function (a, b) {
      return startAbs(a) - startAbs(b);
    });
    const name = nameOf.get(staffId) ?? "This person";
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (!prev || !next) continue;
      const gap = startAbs(next) - endAbs(prev);
      if (gap >= MIN_REST) continue;
      let message: string;
      if (gap <= 0) {
        message =
          name +
          " has two shifts that overlap or run straight into each other on " +
          dayName(next.date) +
          ". Your minimum is 11 hours between shifts.";
      } else if (prev.date === next.date) {
        message =
          name +
          " would have only " +
          hoursText(gap) +
          " between two shifts on " +
          dayName(next.date) +
          ". Your minimum is 11 hours.";
      } else {
        message =
          name +
          " would have only " +
          hoursText(gap) +
          " between finishing on " +
          dayName(prev.date) +
          " and starting on " +
          dayName(next.date) +
          ". Your minimum is 11 hours.";
      }
      out.push({ staffId: staffId, date: next.date, message: message });
    }
  });
  return out;
}
