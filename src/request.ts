// Before the assistant starts, ShiftGuard notes any facts in the owner's request ("Sarah's out all week")
// as days people can't work. The owner's availability rule then holds every suggestion to them.
import { z } from "zod";
import { ask } from "./claude.js";
import type { Rota } from "./domain.js";

const Noted = z.object({
  absences: z.array(
    z.object({
      staffId: z.string().describe("id from the staff list"),
      dates: z.array(z.string()).describe("ISO dates within the week that this person can't work"),
      reason: z.string().describe("Short reason in plain words, e.g. 'Off sick (flu)'"),
    }),
  ),
});

export interface Absence {
  staffId: string;
  name: string;
  dates: string[];
  reason: string;
}

export async function noteAbsences(request: string, week: Rota): Promise<Absence[]> {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${week.weekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return `${d.toISOString().slice(0, 10)} (${d.toLocaleDateString("en-IE", { weekday: "long", timeZone: "UTC" })})`;
  });
  const out = await ask({
    step: "request.note",
    system: "You read a café owner's message about the rota and note who can't work which days this week. Only note what the message says. If nobody is off, return an empty list.",
    messages: [{ role: "user", content: `Staff: ${JSON.stringify(week.staff.map((p) => ({ id: p.id, name: p.name })))}\nThis week: ${days.join(", ")}\n\nMessage: "${request}"` }],
    schema: Noted,
    effort: "low",
  });
  const valid = new Set(days.map((d) => d.slice(0, 10)));
  return out.absences
    .map((a) => ({ ...a, dates: a.dates.filter((d) => valid.has(d)), name: week.staff.find((p) => p.id === a.staffId)?.name ?? "" }))
    .filter((a) => a.name && a.dates.length);
}

export function withAbsences(week: Rota, absences: Absence[]): Rota {
  const rota = structuredClone(week);
  for (const a of absences) {
    const person = rota.staff.find((p) => p.id === a.staffId);
    if (!person) continue;
    for (const date of a.dates) if (!person.unavailable.some((u) => u.date === date)) person.unavailable.push({ date, reason: a.reason });
  }
  return rota;
}
