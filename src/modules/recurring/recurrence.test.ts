import { describe, expect, it } from "vitest";
import { describeRecurrence, firstOccurrenceOnOrAfter, nextOccurrence, type RecurrenceRule } from "./recurrence.js";
import { isoDateInZone } from "../../utils/dates.js";

const tz = "Asia/Colombo";
// Local midnight in Sri Lanka as a UTC instant: 18:30 UTC the day before.
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const iso = (d: Date) => isoDateInZone(d, tz);
const rule = (frequency: RecurrenceRule["frequency"], start: string, interval = 1): RecurrenceRule => ({ frequency, interval, startDate: day(start) });

describe("nextOccurrence", () => {
  it("daily and weekly", () => {
    expect(iso(nextOccurrence(rule("DAILY", "2026-11-15"), day("2026-11-15"), tz))).toBe("2026-11-16");
    expect(iso(nextOccurrence(rule("DAILY", "2026-11-15", 3), day("2026-11-15"), tz))).toBe("2026-11-18");
    expect(iso(nextOccurrence(rule("WEEKLY", "2026-11-15"), day("2026-11-15"), tz))).toBe("2026-11-22");
    expect(iso(nextOccurrence(rule("WEEKLY", "2026-12-28", 2), day("2026-12-28"), tz))).toBe("2027-01-11");
  });

  it("monthly keeps the day", () => {
    expect(iso(nextOccurrence(rule("MONTHLY", "2026-11-05"), day("2026-11-05"), tz))).toBe("2026-12-05");
    expect(iso(nextOccurrence(rule("MONTHLY", "2026-12-05"), day("2026-12-05"), tz))).toBe("2027-01-05");
    expect(iso(nextOccurrence(rule("MONTHLY", "2026-01-10", 3), day("2026-01-10"), tz))).toBe("2026-04-10");
  });

  it("monthly on the 31st clamps to short months and comes back", () => {
    const r = rule("MONTHLY", "2026-01-31");
    const feb = nextOccurrence(r, day("2026-01-31"), tz);
    expect(iso(feb)).toBe("2026-02-28");
    const mar = nextOccurrence(r, feb, tz);
    expect(iso(mar)).toBe("2026-03-31"); // not drifted to the 28th
    expect(iso(nextOccurrence(r, mar, tz))).toBe("2026-04-30");
  });

  it("leap day: monthly and yearly", () => {
    expect(iso(nextOccurrence(rule("MONTHLY", "2028-01-29"), day("2028-01-29"), tz))).toBe("2028-02-29");
    expect(iso(nextOccurrence(rule("YEARLY", "2028-02-29"), day("2028-02-29"), tz))).toBe("2029-02-28");
    expect(iso(nextOccurrence(rule("YEARLY", "2028-02-29", 4), day("2028-02-29"), tz))).toBe("2032-02-29");
  });

  it("yearly keeps the month and day", () => {
    expect(iso(nextOccurrence(rule("YEARLY", "2026-04-14"), day("2026-04-14"), tz))).toBe("2027-04-14");
  });

  it("every occurrence is local midnight, so it is never off by a day", () => {
    const next = nextOccurrence(rule("MONTHLY", "2026-11-01"), day("2026-11-01"), tz);
    expect(next.toISOString()).toBe("2026-11-30T18:30:00.000Z"); // 1 December 00:00 in Sri Lanka
  });
});

describe("firstOccurrenceOnOrAfter", () => {
  it("returns the start when it is already in the future", () => {
    expect(iso(firstOccurrenceOnOrAfter(rule("MONTHLY", "2026-12-01"), day("2026-11-15"), tz))).toBe("2026-12-01");
  });
  it("skips the occurrences that were missed", () => {
    expect(iso(firstOccurrenceOnOrAfter(rule("MONTHLY", "2026-01-05"), day("2026-11-15"), tz))).toBe("2026-12-05");
    expect(iso(firstOccurrenceOnOrAfter(rule("WEEKLY", "2026-11-01"), day("2026-11-15"), tz))).toBe("2026-11-15");
  });
});

describe("describeRecurrence", () => {
  it("reads naturally", () => {
    expect(describeRecurrence(rule("MONTHLY", "2026-11-01"), tz)).toBe("Every month on the 1st");
    expect(describeRecurrence(rule("MONTHLY", "2026-11-22", 2), tz)).toBe("Every 2 months on the 22nd");
    expect(describeRecurrence(rule("MONTHLY", "2026-11-13"), tz)).toBe("Every month on the 13th");
    expect(describeRecurrence(rule("WEEKLY", "2026-11-01", 2), tz)).toBe("Every 2 weeks");
    expect(describeRecurrence(rule("DAILY", "2026-11-01"), tz)).toBe("Every day");
    expect(describeRecurrence(rule("YEARLY", "2026-04-14"), tz)).toBe("Every year on 14 Apr");
  });
});
