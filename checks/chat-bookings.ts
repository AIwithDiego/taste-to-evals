// Written by Claude from the interview on 2026-10-21. Chatbot rule: Chat books tables only for up to eight, 7am to 7pm
import type { Allergen, AllergenEntry, Claims, ReplyFacts, Shop, Violation } from "../src/chat/domain.js";

function parseTime(t: string | null): number | null {
  if (t === null) return null;
  const parts = t.split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const min = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function fmt(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const min = mins % 60;
  const suffix = h24 < 12 ? 'am' : 'pm';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const mm = min === 0 ? '' : '.' + (min < 10 ? '0' + String(min) : String(min));
  return String(h12) + mm + suffix;
}

export function check(input: ReplyFacts): Violation[] {
  const out: Violation[] = [];
  const earliest = 7 * 60;
  const latest = 19 * 60;
  for (const b of input.claims.bookings) {
    const day = b.day !== null ? ' on ' + b.day : '';
    if (b.partySize === null) {
      out.push({ message: 'The reply books a table' + day + ' without saying how many people. Your rule lets the chat book only for up to 8, so this goes to you.' });
    } else if (b.partySize > 8) {
      out.push({ message: 'The reply books a table for ' + String(b.partySize) + ' people' + day + '. Your rule lets the chat book only for up to 8, so bigger groups go to you.' });
    }
    const t = parseTime(b.time);
    if (t === null) {
      out.push({ message: 'The reply books a table' + day + ' without a clear time. Your rule lets the chat book only from 7am to 7pm, so this goes to you.' });
    } else if (t < earliest || t > latest) {
      out.push({ message: 'The reply books a table at ' + fmt(t) + day + '. Your rule lets the chat book only from 7am to 7pm, so this goes to you.' });
    }
  }
  return out;
}
