// Written by Claude from the interview on 2026-10-20. Rule: Never roster someone on a day they've said they can't work
import type { Role, Rota, Shift, ShiftKind, Staff, Violation } from "../src/domain.js";

const DAY_NAMES: string[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES: string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function dayLabel(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const when = new Date(Date.UTC(y, m - 1, d));
  const wd = DAY_NAMES[when.getUTCDay()] ?? "";
  const mn = MONTH_NAMES[m - 1] ?? "";
  return wd + " " + d + " " + mn;
}
export function check(rota: Rota): Violation[] {
  const violations: Violation[] = [];
  const people = new Map<string, Staff>();
  for (const s of rota.staff) {
    people.set(s.id, s);
  }
  const reported = new Set<string>();
  for (const shift of rota.shifts) {
    const person = people.get(shift.staffId);
    if (person === undefined) {
      continue;
    }
    for (const block of person.unavailable) {
      if (block.date !== shift.date) {
        continue;
      }
      const key = person.id + "|" + shift.date;
      if (reported.has(key)) {
        continue;
      }
      reported.add(key);
      violations.push({
        staffId: person.id,
        date: shift.date,
        message:
          person.name +
          " is rostered on " +
          dayLabel(shift.date) +
          ", a day they have said they cannot work (" +
          block.reason +
          ").",
      });
    }
  }
  return violations;
}
