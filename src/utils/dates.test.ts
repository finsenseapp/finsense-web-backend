import { describe, expect, it } from "vitest";
import { monthRange, parseDateInput, parseRangeEnd, yearMonthInZone } from "./dates.js";

const TZ = "Asia/Colombo"; // UTC+05:30, no DST

describe("date helpers (Asia/Colombo)", () => {
  it("month range starts at local midnight (previous day 18:30 UTC)", () => {
    const { from, to } = monthRange(2026, 11, TZ);
    expect(from.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });

  it("December rolls into the next year", () => {
    const { from, to } = monthRange(2026, 12, TZ);
    expect(from.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });

  it("an instant late on Nov 30 UTC is already December in Colombo", () => {
    expect(yearMonthInZone(new Date("2026-11-30T20:00:00Z"), TZ)).toEqual({ year: 2026, month: 12 });
  });

  it("date-only input means the start of that day in the app timezone", () => {
    expect(parseDateInput("2026-11-14", TZ)?.toISOString()).toBe("2026-11-13T18:30:00.000Z");
  });

  it("date-only 'to' filters include the whole day", () => {
    expect(parseRangeEnd("2026-11-14", TZ)?.toISOString()).toBe("2026-11-14T18:30:00.000Z");
  });

  it("rejects impossible dates and garbage", () => {
    expect(parseDateInput("2026-02-31", TZ)).toBeNull();
    expect(parseDateInput("not-a-date", TZ)).toBeNull();
  });

  it("full ISO date-times are used as-is", () => {
    expect(parseDateInput("2026-11-14T10:00:00Z", TZ)?.toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });
});
