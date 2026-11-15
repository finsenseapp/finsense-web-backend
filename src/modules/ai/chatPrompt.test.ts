import { describe, expect, it } from "vitest";
import { buildChatInstruction, formatCrossLines, formatRateLines } from "./chatPrompt.js";
import type { RatesPayload } from "../../services/ratesService.js";

const payload: RatesPayload = {
  base: "LKR",
  rates: { LKR: 1, USD: 0.0031, EUR: 0.0028 },
  updatedAt: "2026-11-15T00:00:00.000Z",
  source: "exchangerate-api.com",
};

describe("chat prompt", () => {
  it("turns per-LKR rates into LKR-per-unit lines and skips missing currencies", () => {
    expect(formatRateLines(payload)).toEqual(["1 USD = 322.58 LKR", "1 EUR = 357.14 LKR"]);
  });

  it("computes direct cross rates from the per-LKR rates", () => {
    // 1 USD = 322.58 LKR and 1 EUR = 357.14 LKR, so 1 USD = 0.903226 EUR
    expect(formatCrossLines(payload)).toContain("1 USD = 0.903226 EUR");
    expect(formatCrossLines(payload)).toContain("1 EUR = 1.1071 USD");
  });

  it("includes the rates and a safe fallback when they are unavailable", () => {
    const base = { today: "Sunday", userName: "A", currency: "LKR" };
    expect(buildChatInstruction({ ...base, rates: payload })).toContain("1 USD = 322.58 LKR");
    expect(buildChatInstruction({ ...base, rates: null })).toContain("unavailable");
  });
});
