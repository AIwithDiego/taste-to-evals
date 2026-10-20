// Written by Claude from the interview on 2026-10-20. Rule: Minimum staff while open, three on Saturday mornings
import type { Role, Rota, Shift, ShiftKind, Staff, Violation } from "../src/domain.js";

export function check(rota: Rota): Violation[] {
  const out: Violation[] = [];
  const words: string[] = ["none", "one", "two", "three"];
  const months: string[] = [
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
  const dayNames: string[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const OPEN = 420;
  const CLOSE = 1200;
  const RUSH_FROM = 480;
  const RUSH_TO = 720;
  function minutesOf(hhmm: string): number {
    const p = hhmm.split(":");
    return Number(p[0]) * 60 + Number(p[1]);
  }
  function clock(min: number): string {
    if (min === 720) return "12 noon";
    const h24 = Math.floor(min / 60);
    const mm = min % 60;
    const suffix = h24 < 12 ? "am" : "pm";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    if (mm === 0) return h12 + " " + suffix;
    return h12 + ":" + (mm < 10 ? "0" : "") + mm + " " + suffix;
  }
  const ws = rota.weekStart.split("-");
  const baseMs = Date.UTC(Number(ws[0]), Number(ws[1]) - 1, Number(ws[2]));
  for (let i = 0; i < 7; i++) {
    const d = new Date(baseMs + i * 86400000);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const dayName = dayNames[dow] ?? "";
    const monthName = months[d.getUTCMonth()] ?? "";
    const dayNum = d.getUTCDate();
    const spans = rota.shifts
      .filter((s) => s.date === date)
      .map((s) => ({ id: s.staffId, from: minutesOf(s.start), to: minutesOf(s.end) }));
    let runStart = -1;
    let runHave = -1;
    let runNeed = -1;
    for (let m = OPEN; m <= CLOSE; m++) {
      let have = -1;
      let need = -1;
      if (m < CLOSE) {
        const on = new Set<string>();
        for (const sp of spans) {
          if (sp.from <= m && m < sp.to) on.add(sp.id);
        }
        have = on.size;
        need = dow === 6 && m >= RUSH_FROM && m < RUSH_TO ? 3 : 2;
      }
      const short = have >= 0 && have < need;
      const same = short && runStart >= 0 && have === runHave && need === runNeed;
      if (runStart >= 0 && !same) {
        const dutyText =
          runHave === 0
            ? "Nobody is on duty"
            : runHave === 1
              ? "Only one person is on duty"
              : "Only " + (words[runHave] ?? "") + " people are on duty";
        out.push({
          date: date,
          message:
            "On " +
            dayName +
            " " +
            dayNum +
            " " +
            monthName +
            ", from " +
            clock(runStart) +
            " to " +
            clock(m) +
            ", " +
            dutyText +
            ". Your minimum for that time is " +
            (words[runNeed] ?? "") +
            " people.",
        });
        runStart = -1;
      }
      if (short && runStart < 0) {
        runStart = m;
        runHave = have;
        runNeed = need;
      }
    }
  }
  return out;
}
