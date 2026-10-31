const DAY_MS = 86_400_000;
export const DEFAULT_TIME_ZONE = "Australia/Sydney";

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};

/** Today's date (YYYY-MM-DD) in a time zone. */
export const todayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", ...opts }).format(toUtc(date));

/** A due date as a short relative label, e.g. "Today", "Tomorrow", "Fri", "3 Nov", "3 Nov 2027". */
export function formatDue(date: string, today: string): { text: string; overdue: boolean } {
  const days = daysBetween(today, date);
  const overdue = days < 0;
  if (days === 0) return { text: "Today", overdue };
  if (days === 1) return { text: "Tomorrow", overdue };
  if (days === -1) return { text: "Yesterday", overdue };
  if (days > 1 && days < 7) return { text: fmt(date, { weekday: "short" }), overdue };
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return { text: fmt(date, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }), overdue };
}

/** A day and an optional wall-clock time ("HH:MM") in the user's time zone. */
export interface When { date: string; time: string | null }

export const addDays = (date: string, n: number) => new Date(toUtc(date).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** 0 is Sunday. */
export const weekdayOf = (date: string) => toUtc(date).getUTCDay();

const parts = (timeZone: string, at: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** How far the zone is ahead of UTC at an instant, in milliseconds. */
const offsetAt = (timeZone: string, at: number) => {
  const p = parts(timeZone, new Date(Math.floor(at / 1000) * 1000));
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return wall - Math.floor(at / 1000) * 1000;
};

/** A wall-clock date and time in a zone as a UTC timestamp. Checked twice so it holds across a daylight-saving change. */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [h, m] = time.split(":").map(Number);
  const wall = toUtc(date).getTime() + (h! * 60 + m!) * 60_000;
  let at = wall - offsetAt(timeZone, wall);
  at = wall - offsetAt(timeZone, at);
  return new Date(at).toISOString();
}

/** A timestamp as the local date and "HH:MM" in a zone. */
export function splitIn(iso: string, timeZone: string): { date: string; time: string } {
  const p = parts(timeZone, new Date(iso));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** "15:05" as "3:05 pm". */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h! % 12 || 12}:${String(m).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}`;
}

/** A When as "Fri, 3:00 pm"; overdue once its day, or its time today, has passed. */
export function formatWhen(when: When, today: string, nowTime: string): { text: string; overdue: boolean } {
  const day = formatDue(when.date, today);
  if (!when.time) return day;
  const overdue = day.overdue || (when.date === today && when.time < nowTime);
  return { text: `${day.text}, ${formatTime(when.time)}`, overdue };
}
