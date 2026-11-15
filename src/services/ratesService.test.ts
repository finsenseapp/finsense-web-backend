import { describe, expect, it } from "vitest";
import { parseProviderResponse } from "./ratesService.js";

const good = {
  result: "success",
  base_code: "LKR",
  time_last_update_unix: 1794614551,
  rates: { LKR: 1, USD: 0.0033, AUD: 0.004416, "bad-code": 5 },
};

describe("parseProviderResponse", () => {
  it("keeps valid codes, forces LKR to 1 and reports the update time", () => {
    const p = parseProviderResponse(good);
    expect(p.base).toBe("LKR");
    expect(p.rates).toEqual({ LKR: 1, USD: 0.0033, AUD: 0.004416 });
    expect(p.updatedAt).toBe(new Date(1794614551 * 1000).toISOString());
  });

  it("rejects an error response, a wrong base and non-positive rates", () => {
    expect(() => parseProviderResponse({ ...good, result: "error" })).toThrow();
    expect(() => parseProviderResponse({ ...good, base_code: "USD" })).toThrow();
    expect(() => parseProviderResponse({ ...good, rates: { USD: 0 } })).toThrow();
  });
});
