import { describe, expect, it } from "vitest";
import { Decimal } from "../../utils/money.js";
import { lastMonthKeys, netWorthSeries, savingsRate } from "./report-math.js";

const tz = "Asia/Colombo";

describe("lastMonthKeys", () => {
  it("lists the months oldest first, ending with this one, across a year end", () => {
    expect(lastMonthKeys(new Date("2026-02-15T10:00:00Z"), 4, tz)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("uses Sri Lanka time at the month boundary", () => {
    // 31 Oct 19:00 UTC is already 1 Nov 00:30 in Sri Lanka
    expect(lastMonthKeys(new Date("2026-10-31T19:00:00Z"), 2, tz)).toEqual(["2026-10", "2026-11"]);
  });
  it("one month is just this month", () => expect(lastMonthKeys(new Date("2026-11-15T10:00:00Z"), 1, tz)).toEqual(["2026-11"]));
});

describe("netWorthSeries", () => {
  const keys = ["2026-09", "2026-10", "2026-11"];
  it("works backwards from today: each month end is today minus the later months' net flow", () => {
    // today 100000. Nov: earned 50000 spent 20000 (+30000). Oct: +10000. Sep: -5000.
    const flows = new Map([["2026-11", new Decimal(30000)], ["2026-10", new Decimal(10000)], ["2026-09", new Decimal(-5000)]]);
    const series = netWorthSeries("100000", keys, flows).map((d) => d.toFixed(2));
    expect(series).toEqual(["60000.00", "70000.00", "100000.00"]);
  });
  it("a month with no activity keeps the value of the next month", () => {
    expect(netWorthSeries("500", keys, new Map()).map((d) => d.toFixed(2))).toEqual(["500.00", "500.00", "500.00"]);
  });
  it("stays exact with cents", () => {
    const flows = new Map([["2026-11", new Decimal("0.1")], ["2026-10", new Decimal("0.2")]]);
    expect(netWorthSeries("1.00", keys, flows).map((d) => d.toFixed(2))).toEqual(["0.70", "0.90", "1.00"]);
  });
});

describe("savingsRate", () => {
  it("percent of income not spent, one decimal", () => {
    expect(savingsRate("85000", "63750")).toBe(25);
    expect(savingsRate("30000", "10000")).toBe(66.7);
  });
  it("negative when spending more than earned", () => expect(savingsRate("1000", "1500")).toBe(-50));
  it("null when there was no income", () => {
    expect(savingsRate("0", "500")).toBeNull();
    expect(savingsRate("-1", "0")).toBeNull();
  });
});
