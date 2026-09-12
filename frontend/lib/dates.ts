/**
 * Shared date helpers, pulled out of the page components that each had their
 * own copy.
 *
 * READ THIS BEFORE ADDING TO IT. CLAUDE.md's "Frontend stays thin" rule says
 * date and period maths belongs in the backend, and it names this code
 * specifically: a custom-week vs ISO-week mismatch in `getCustomWeekStart`
 * caused a real, user-visible reimbursement-total bug. This module is a
 * staging post, not a home — somewhere the duplicates could be collapsed into
 * one tested implementation before each is moved server-side. Prefer adding a
 * field to an API response over adding a function here.
 *
 * Everything below is pure: no `new Date()` read from inside a function, no
 * locale formatting. Formatting stays in the components, because the two
 * callers of `getWeekRange` genuinely differ (one shows the year on the end
 * date, one does not) and collapsing that would be a behaviour change
 * disguised as a refactor.
 */

/** Local-timezone `YYYY-MM-DD`. Deliberately not `toISOString()`, which is UTC
 *  and rolls the date backwards for anywhere east of Greenwich — Singapore
 *  included, which is every household using this today. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Start of the household's custom week containing `date`.
 *
 * `summaryDay` is the payout/start day and the week runs
 * summaryDay → summaryDay+6, so the Sunday after a Saturday payout is already
 * day 2 of the new cycle.
 *
 * The conversion on the first line is the whole reason this needs a test:
 * the backend numbers days 0=Mon…6=Sun (matching `settings.summary_day` and
 * Python's `date.weekday()`), while JavaScript's `getDay()` is 0=Sun…6=Sat.
 */
export function getCustomWeekStart(date: Date, summaryDay: number): Date {
  const jsTarget = (summaryDay + 1) % 7;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - jsTarget + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function getCustomWeekEnd(start: Date): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

/**
 * Monday–Sunday date range of an ISO week.
 *
 * Anchored on 4 January, which ISO 8601 guarantees falls in week 1 of its year.
 * Note this is a *different* week grid from `getCustomWeekStart` above: a
 * household whose `summary_day` isn't Monday sees weeks that straddle two ISO
 * weeks, which is exactly the mismatch that produced the reimbursement bug.
 */
export function getWeekRange(year: number, week: number): { start: Date; end: Date } {
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(startOfWeek1);
  start.setDate(startOfWeek1.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/**
 * Whole days from today until `dateStr`; negative once it has passed.
 *
 * `now` is injectable so this is testable and so a list of policies renders
 * against one consistent "today" rather than re-reading the clock per row.
 */
export function daysUntil(dateStr: string | null, now: Date = new Date()): number | null {
  if (!dateStr) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}
