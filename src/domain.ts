// The shapes everything shares: staff, shifts, a week's rota, and what a broken rule looks like.

export type Role = "barista" | "floor" | "kitchen";
export type ShiftKind = "open" | "mid" | "close";

export interface Staff {
  id: string;
  name: string;
  role: Role;
  trainedBarista: boolean;
  contractHours: number;
  /** ISO dates the person can't work, with the reason they gave. */
  unavailable: { date: string; reason: string }[];
}

export interface Shift {
  id: string;
  staffId: string;
  /** ISO date, e.g. "2026-10-26". */
  date: string;
  /** 24h clock, "HH:MM". Shifts never cross midnight (the café shuts at 20:00). */
  start: string;
  end: string;
  kind: ShiftKind;
}

export interface Rota {
  cafe: string;
  weekStart: string;
  staff: Staff[];
  shifts: Shift[];
  /** Weekend shifts each person worked over the previous four weeks (for judging fairness). */
  weekendHistory?: Record<string, number>;
}

/** One broken rule, said the way the owner would say it. */
export interface Violation {
  staffId?: string;
  date?: string;
  message: string;
}

export type CheckFn = (rota: Rota) => Violation[];

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Bad time "${hhmm}", expected HH:MM`);
  }
  return h * 60 + m;
}

export function shiftHours(shift: Shift): number {
  return (toMinutes(shift.end) - toMinutes(shift.start)) / 60;
}
