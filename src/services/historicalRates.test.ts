import { describe, expect, it } from "vitest";
import { parseDayRates } from "./historicalRates.js";

describe("parseDayRates", () => {
  it("keeps real currency codes, upper-cased, and adds LKR", () => {
    const rates = parseDayRates({ date: "2025-06-10", lkr: { usd: 0.0031, eur: 0.0027, aud: 0.0048 } });
    expect(rates).toEqual({ USD: 0.0031, EUR: 0.0027, AUD: 0.0048, LKR: 1 });
  });

  it("drops crypto tokens, junk and broken numbers", () => {
    const rates = parseDayRates({ lkr: { ada: 0.018, "1inch": 0.04, btc: 0.0000001, usd: 0.0031, eur: 0, gbp: -1, jpy: "x", aud: null } });
    expect(Object.keys(rates).sort()).toEqual(["LKR", "USD"]);
  });

  it("rejects an unexpected response", () => {
    expect(() => parseDayRates({})).toThrow();
    expect(() => parseDayRates(null)).toThrow();
  });
});
