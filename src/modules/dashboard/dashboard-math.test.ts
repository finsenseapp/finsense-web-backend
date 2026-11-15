import { describe, expect, it } from "vitest";
import { percentChange, previousMonth } from "./dashboard-math.js";

describe("percentChange", () => {
  it("increase", () => expect(percentChange("110", "100")).toBe(10));
  it("decrease", () => expect(percentChange("75", "100")).toBe(-25));
  it("no change", () => expect(percentChange("100", "100")).toBe(0));
  it("rounds to one decimal", () => expect(percentChange("26500", "24450.50")).toBe(8.4));
  it("a previous value of zero cannot be compared", () => {
    expect(percentChange("500", "0")).toBeNull();
    expect(percentChange("0", "0")).toBeNull();
  });
  it("a negative previous value uses its absolute size, so improving reads as positive", () => {
    // net savings went from -1000 to +500: that is a 150% improvement
    expect(percentChange("500", "-1000")).toBe(150);
  });
  it("is exact for tiny decimals (0.2 vs 0.1)", () => expect(percentChange("0.2", "0.1")).toBe(100));
});

describe("previousMonth", () => {
  it("mid-year", () => expect(previousMonth(2026, 11)).toEqual({ year: 2026, month: 10 }));
  it("January wraps to December of the year before", () => expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 }));
});

import { addDaysIso, mondayOnOrBefore, resolvePeriod } from "./dashboard-math.js";

describe("weeks", () => {
  it("snaps any day to its Monday (weeks run Monday to Sunday)", () => {
    expect(mondayOnOrBefore("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(mondayOnOrBefore("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(mondayOnOrBefore("2026-11-12")).toBe("2026-11-09"); // Thursday
  });
  it("adds days across month and year ends", () => {
    expect(addDaysIso("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDaysIso("2026-03-02", -7)).toBe("2026-02-23");
  });
});

describe("resolvePeriod", () => {
  const tz = "Asia/Colombo"; // UTC+5:30, so local midnight is 18:30 UTC the day before
  const now = new Date("2026-11-15T10:00:00Z");

  it("week: Monday to the next Monday, previous week right before it", () => {
    const p = resolvePeriod({ range: "week" }, tz, now);
    expect(p.weekStart).toBe("2026-11-09");
    expect(p.from.toISOString()).toBe("2026-11-08T18:30:00.000Z");
    expect(p.to.toISOString()).toBe("2026-11-15T18:30:00.000Z");
    expect(p.prevTo.toISOString()).toBe(p.from.toISOString());
    expect(p.to.getTime() - p.from.getTime()).toBe(7 * 86400000);
  });
  it("week: a given date is snapped to its Monday", () => {
    expect(resolvePeriod({ range: "week", weekStart: "2026-11-12" }, tz, now).weekStart).toBe("2026-11-09");
  });
  it("month: whole month, previous month before it", () => {
    const p = resolvePeriod({ range: "month", month: 1, year: 2026 }, tz, now);
    expect(p.from.toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(p.to.toISOString()).toBe("2026-01-31T18:30:00.000Z");
    expect(p.prevFrom.toISOString()).toBe("2025-11-30T18:30:00.000Z");
  });
  it("year: Jan 1 to Jan 1, previous year before it", () => {
    const p = resolvePeriod({ range: "year", year: 2026 }, tz, now);
    expect(p.from.toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(p.to.toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(p.prevFrom.toISOString()).toBe("2024-12-31T18:30:00.000Z");
    expect(p.prevTo.toISOString()).toBe(p.from.toISOString());
  });
  it("defaults to the current month", () => {
    const p = resolvePeriod({ range: "month" }, tz, now);
    expect([p.year, p.month]).toEqual([2026, 11]);
  });
});
