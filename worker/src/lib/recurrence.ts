import { eq } from "drizzle-orm";
import { RRule } from "rrule";
import { settings } from "../db/schema";
import type { Db } from "./db";

export const DEFAULT_TIME_ZONE = "Australia/Sydney";
const DAY_MS = 86_400_000;

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const toDate = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => toDate(new Date(toUtc(date).getTime() + days * DAY_MS));
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);

/** Today's date (YYYY-MM-DD) in a time zone. */
export const todayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** A rule we can advance: parses, has a FREQ, and is no finer than daily (so the calculation stays cheap). */
export function isValidRule(rule: string): boolean {
  try {
    const options = RRule.parseString(rule);
    if (options.freq === undefined || options.freq > RRule.DAILY) return false;
    new RRule({ ...options, dtstart: new Date(0) }).after(new Date(0), false); // throws on bad parts such as BYDAY=XX
    return true;
  } catch {
    return false;
  }
}

/**
 * The next due date (YYYY-MM-DD) after completing a recurring task, or null if the rule has run out.
 * From `due`: the first occurrence after the later of the old due date and today, keeping the rule's
 * phase. From `completion` (or with no due date): the first occurrence after today.
 */
export function nextDueDate(rule: string, from: "due" | "completion", due: string | null, today: string): string | null {
  const anchor = from === "due" && due !== null ? due : today;
  const after = anchor > today ? anchor : today;
  const next = new RRule({ ...RRule.parseString(rule), dtstart: toUtc(anchor) }).after(toUtc(after), false);
  return next ? toDate(next) : null;
}

/** The user's time zone from settings, or the default. */
export async function userTimeZone(db: Db): Promise<string> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "timeZone"));
  return typeof row?.value === "string" && row.value ? row.value : DEFAULT_TIME_ZONE;
}
