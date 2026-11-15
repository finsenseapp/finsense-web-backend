import { describe, expect, it } from "vitest";
import { goalProgress } from "./goal-math.js";

const tz = "Asia/Colombo";
const now = new Date("2026-11-15T10:00:00Z"); // 15 Nov 2026 in Sri Lanka
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

describe("goalProgress", () => {
  it("percent saved and what is left", () => {
    const p = goalProgress("100000", "25000", null, now, tz);
    expect(p.percentSaved).toBe(25);
    expect(p.remaining.toFixed(2)).toBe("75000.00");
    expect(p.achieved).toBe(false);
    expect(p.monthlyNeeded).toBeNull();
  });

  it("rounds the percentage to one decimal, exactly", () => {
    expect(goalProgress("30000", "10000", null, now, tz).percentSaved).toBe(33.3);
    expect(goalProgress("0.3", "0.1", null, now, tz).percentSaved).toBe(33.3); // no float drift
  });

  it("reaching or passing the target is achieved with nothing remaining", () => {
    const hit = goalProgress("1000", "1000", null, now, tz);
    expect(hit.achieved).toBe(true);
    expect(hit.remaining.toFixed(2)).toBe("0.00");
    const over = goalProgress("1000", "1250.50", null, now, tz);
    expect(over.percentSaved).toBe(125.1);
    expect(over.remaining.toFixed(2)).toBe("0.00");
  });

  it("monthly amount needed, rounded up to the cent", () => {
    // 15 Nov 2026 -> 15 Mar 2027 = 4 months; 100000 - 25000 = 75000 -> 18750 a month
    const p = goalProgress("100000", "25000", day("2027-03-15"), now, tz);
    expect(p.monthsLeft).toBe(4);
    expect(p.monthlyNeeded?.toFixed(2)).toBe("18750.00");
    // 10000 over 3 months = 3333.333... -> 3333.34 (never short)
    expect(goalProgress("10000", "0", day("2027-02-15"), now, tz).monthlyNeeded?.toFixed(2)).toBe("3333.34");
  });

  it("a part month counts as a whole month, and the minimum is one", () => {
    expect(goalProgress("1000", "0", day("2026-12-20"), now, tz).monthsLeft).toBe(2);
    expect(goalProgress("1000", "0", day("2026-11-30"), now, tz).monthsLeft).toBe(1);
    expect(goalProgress("1000", "0", day("2026-11-16"), now, tz).monthlyNeeded?.toFixed(2)).toBe("1000.00");
  });

  it("no monthly amount once achieved, or when the date has passed", () => {
    expect(goalProgress("1000", "1000", day("2027-03-15"), now, tz).monthlyNeeded).toBeNull();
    const late = goalProgress("1000", "100", day("2026-10-01"), now, tz);
    expect(late.monthsLeft).toBeNull();
    expect(late.monthlyNeeded).toBeNull();
  });
});
