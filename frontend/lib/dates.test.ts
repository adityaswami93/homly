/**
 * The week maths behind the expenses pages.
 *
 * CLAUDE.md records that a custom-week vs ISO-week mismatch here caused a real
 * reimbursement-total bug, and until now this code existed as unexported copies
 * inside four page components — untestable, and already drifting. These pin the
 * behaviour so it can be moved to the backend (which is where CLAUDE.md says it
 * belongs) without changing what a household sees.
 *
 * Dates are constructed with `new Date(y, m, d)` rather than parsed from
 * strings: `new Date("2026-09-14")` is parsed as UTC midnight and shifts a day
 * backwards in a negative-offset timezone, which would make these pass or fail
 * depending on where CI runs.
 */
import { describe, expect, it } from "vitest";

import { daysUntil, getCustomWeekEnd, getCustomWeekStart, getWeekRange, toDateStr } from "./dates";

// 2026-09-14 is a Monday; 2026-09-20 is the Sunday that ends that week.
const MON = new Date(2026, 8, 14);
const WED = new Date(2026, 8, 16);
const SUN = new Date(2026, 8, 20);

describe("toDateStr", () => {
  it("formats in local time, not UTC", () => {
    // toISOString().slice(0,10) would give 2026-09-14 here but roll backwards
    // to the 13th for anywhere east of Greenwich — Singapore included, which
    // is every household using this today.
    expect(toDateStr(new Date(2026, 8, 14, 23, 30))).toBe("2026-09-14");
  });

  it("zero-pads month and day", () => {
    expect(toDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("getCustomWeekStart", () => {
  it("treats summaryDay 0 as Monday, matching the backend", () => {
    // settings.summary_day is 0=Mon..6=Sun; JS getDay() is 0=Sun..6=Sat. The
    // `(summaryDay + 1) % 7` conversion is the whole reason this is tested.
    expect(toDateStr(getCustomWeekStart(WED, 0))).toBe("2026-09-14");
    expect(toDateStr(getCustomWeekStart(MON, 0))).toBe("2026-09-14");
  });

  it("treats summaryDay 6 as Sunday, not Saturday", () => {
    expect(toDateStr(getCustomWeekStart(SUN, 6))).toBe("2026-09-20");
    expect(toDateStr(getCustomWeekStart(WED, 6))).toBe("2026-09-13");
  });

  it("puts the Sunday after a Saturday payout in the new cycle", () => {
    // summaryDay 5 = Saturday, so the week starting Sat 19th already contains
    // Sun 20th — it is day 2, not the tail of the previous week.
    expect(toDateStr(getCustomWeekStart(SUN, 5))).toBe("2026-09-19");
  });

  it("normalises away the time of day", () => {
    expect(toDateStr(getCustomWeekStart(new Date(2026, 8, 16, 23, 59), 0))).toBe("2026-09-14");
  });

  it("returns a window containing the date, for every day and every summaryDay", () => {
    // 7x7: the whole input space. Cheaper than arguing about which cases matter.
    for (let summaryDay = 0; summaryDay < 7; summaryDay++) {
      for (let offset = 0; offset < 7; offset++) {
        const date = new Date(2026, 8, 14 + offset);
        const start = getCustomWeekStart(date, summaryDay);
        const end = getCustomWeekEnd(start);
        expect(start.getTime()).toBeLessThanOrEqual(date.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(end.getTime());
        expect(Math.round((end.getTime() - start.getTime()) / 86400000)).toBe(6);
      }
    }
  });

  it("does not mutate the date it was given", () => {
    const original = new Date(2026, 8, 16, 12, 0);
    const before = original.getTime();
    getCustomWeekStart(original, 0);
    expect(original.getTime()).toBe(before);
  });
});

describe("getWeekRange", () => {
  it("anchors week 1 on the ISO week containing 4 January", () => {
    // 2026-01-04 is a Sunday, so ISO week 1 of 2026 starts the Monday before,
    // in the previous calendar year. Getting this wrong shifts every week label.
    const { start, end } = getWeekRange(2026, 1);
    expect(toDateStr(start)).toBe("2025-12-29");
    expect(toDateStr(end)).toBe("2026-01-04");
  });

  it("advances seven days per week", () => {
    expect(toDateStr(getWeekRange(2026, 2).start)).toBe("2026-01-05");
    expect(toDateStr(getWeekRange(2026, 38).start)).toBe("2026-09-14");
  });

  it("always spans Monday to Sunday", () => {
    for (let week = 1; week <= 52; week++) {
      const { start, end } = getWeekRange(2026, week);
      expect(start.getDay()).toBe(1); // Monday
      expect(end.getDay()).toBe(0); // Sunday
    }
  });
});

describe("daysUntil", () => {
  const NOW = new Date(2026, 8, 14, 15, 0);

  it("counts whole days, ignoring the time of day", () => {
    expect(daysUntil("2026-09-14", NOW)).toBe(0);
    expect(daysUntil("2026-09-21", NOW)).toBe(7);
  });

  it("goes negative once the date has passed", () => {
    // Renewal badges rely on this to show an overdue policy rather than "0".
    expect(daysUntil("2026-09-13", NOW)).toBe(-1);
  });

  it("returns null for a missing date", () => {
    expect(daysUntil(null, NOW)).toBeNull();
  });
});
