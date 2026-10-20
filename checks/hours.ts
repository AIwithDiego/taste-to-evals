// Written by Claude from the interview on 2026-10-21. Rule: Max 40 hours a week
import type { Role, Rota, Shift, ShiftKind, Staff, Violation } from "../src/domain.js";

function toMins(hhmm: string): number {
  const parts = hhmm.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function fmtHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return h + ' hours';
  if (m === 30) return h + ' and a half hours';
  return h + ' hours and ' + m + ' minutes';
}

export function check(rota: Rota): Violation[] {
  const totals = new Map<string, number>();
  for (const s of rota.shifts) {
    const mins = toMins(s.end) - toMins(s.start);
    totals.set(s.staffId, (totals.get(s.staffId) || 0) + mins);
  }
  const out: Violation[] = [];
  for (const p of rota.staff) {
    const total = totals.get(p.id) || 0;
    if (total > 2400) {
      out.push({ staffId: p.id, message: p.name + ' would work ' + fmtHours(total) + '. Your limit is 40 hours.' });
    }
  }
  return out;
}
