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
