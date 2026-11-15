import { describe, expect, it } from "vitest";
import { isSupportedCurrency } from "./currencies.js";

describe("isSupportedCurrency", () => {
  it("accepts common ISO 4217 codes", () => {
    for (const code of ["LKR", "USD", "EUR", "GBP", "INR", "JPY", "AUD", "SGD", "AED"]) {
      expect(isSupportedCurrency(code)).toBe(true);
    }
  });

  it("rejects unknown codes, wrong length and wrong case", () => {
    for (const code of ["ABC", "US", "USDX", "", "usd", "Rs", "$"]) {
      expect(isSupportedCurrency(code)).toBe(false);
    }
  });
});
