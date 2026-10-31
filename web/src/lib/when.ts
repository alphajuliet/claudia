import { addDays, splitIn, todayIn, weekdayOf, zonedToUtc, type When } from "./dates";

export type { When };

/** The panel's quick choices for a given today. This weekend is today on a weekend; next week is the coming Monday. */
export function quickDates(today: string) {
  const day = weekdayOf(today);
  return {
    today,
    tomorrow: addDays(today, 1),
    weekend: day === 0 || day === 6 ? today : addDays(today, 6 - day),
    nextWeek: addDays(today, (8 - day) % 7 || 7),
  };
}

/** The due fields for a When: a date alone is `dueDate`, a date with a time is `dueAt`. Never both. */
export const dueFields = (when: When | null, timeZone: string) =>
  !when ? { dueDate: null, dueAt: null }
  : when.time ? { dueDate: null, dueAt: zonedToUtc(when.date, when.time, timeZone) }
  : { dueDate: when.date, dueAt: null };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Index of a name given as at least its first three letters ("fri", "tues", "sept"), or -1. */
const named = (names: string[], word: string) => (word.length >= 3 ? names.findIndex((n) => n.startsWith(word)) : -1);

/** A real calendar date, or null (31/2). */
function calendar(y: number, m: number, d: number): string | null {
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? at.toISOString().slice(0, 10) : null;
}

/** A day and month with an optional year; without one, a day already gone this year is next year's. */
function dayMonth(d: number, m: number, year: string | undefined, today: string): string | null {
  if (year) return calendar(Number(year), m, d);
  const y = Number(today.slice(0, 4));
  const date = calendar(y, m, d);
  return date && date < today ? calendar(y + 1, m, d) : date;
}

const ORDINAL = "(\\d{1,2})(?:st|nd|rd|th)?";

/** All of `words` as a date, or null. */
function parseDate(words: string[], today: string): string | null {
  if (words[0] === "on" && words.length > 1) words = words.slice(1);
  const s = words.join(" ");
  if (s === "today" || s === "tod") return today;
  if (s === "tomorrow" || s === "tmr" || s === "tmrw") return addDays(today, 1);
  if (s === "weekend" || s === "this weekend") return quickDates(today).weekend;
  if (s === "next week") return quickDates(today).nextWeek;
  let m = /^in (\d{1,3}) (days?|weeks?)$/.exec(s);
  if (m) return addDays(today, Number(m[1]) * (m[2]!.startsWith("week") ? 7 : 1));
  m = /^(next |this )?([a-z]+)$/.exec(s);
  if (m) {
    const day = named(DAYS, m[2]!);
    if (day >= 0) {
      const ahead = (day - weekdayOf(today) + 7) % 7;
      return addDays(today, ahead + (m[1] === "next " ? 7 : 0));
    }
  }
  m = new RegExp(`^${ORDINAL} ([a-z]+)(?: (\\d{4}))?$`).exec(s);
  if (m && named(MONTHS, m[2]!) >= 0) return dayMonth(Number(m[1]), named(MONTHS, m[2]!) + 1, m[3], today);
  m = new RegExp(`^([a-z]+) ${ORDINAL}(?: (\\d{4}))?$`).exec(s);
  if (m && named(MONTHS, m[1]!) >= 0) return dayMonth(Number(m[2]), named(MONTHS, m[1]!) + 1, m[3], today);
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s);
  if (m) return dayMonth(Number(m[1]), Number(m[2]), m[3], today);
  return null;
}

const hhmm = (h: number, min: number) => `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

/** All of `words` as a time ("HH:MM"), or null. A bare number is not a time. */
function parseTime(words: string[]): string | null {
  if (words[0] === "at" && words.length > 1) words = words.slice(1);
  const s = words.join("");
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";
  let m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)$/.exec(s);
  if (m) {
    const h = Number(m[1]), min = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || min > 59) return null;
    return hhmm((h % 12) + (m[3]!.startsWith("p") ? 12 : 0), min);
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return hhmm(Number(m[1]), Number(m[2]));
  return null;
}

/** All of `words` as a day, a time, or both in either order. */
function parseTail(words: string[], today: string): { date: string | null; time: string | null } | null {
  const date = parseDate(words, today);
  if (date) return { date, time: null };
  const time = parseTime(words);
  if (time) return { date: null, time };
  for (let k = 1; k < words.length; k++) {
    const [a, b] = [words.slice(0, k), words.slice(k)];
    const dt = parseDate(a, today), tt = parseTime(b);
    if (dt && tt) return { date: dt, time: tt };
    const td = parseTime(a), dd = parseDate(b, today);
    if (td && dd) return { date: dd, time: td };
  }
  return null;
}

const MAX_TAIL = 6;
const word = (w: string) => w.toLowerCase().replace(/[,.]+$/, "");

/**
 * A date or time at the end of quick-add text: the longest tail of words that reads as one, leaving at least one word
 * of title. `matched` is the tail as typed. A time alone is today, or tomorrow once it has passed.
 */
export function parseWhen(text: string, now: Date, timeZone: string): { title: string; matched: string; when: When } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const today = todayIn(timeZone, now);
  for (let i = Math.max(1, words.length - MAX_TAIL); i < words.length; i++) {
    const tail = parseTail(words.slice(i).map(word), today);
    if (!tail) continue;
    const date = tail.date ?? (tail.time! > splitIn(now.toISOString(), timeZone).time ? today : addDays(today, 1));
    return { title: words.slice(0, i).join(" "), matched: words.slice(i).join(" "), when: { date, time: tail.time } };
  }
  return null;
}
