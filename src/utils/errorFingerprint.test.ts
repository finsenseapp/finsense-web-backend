import { describe, expect, it } from "vitest";
import { fingerprintOf, pathOnly, scrubText } from "./errorFingerprint.js";

describe("scrubText", () => {
  it("removes emails, ids and long numbers", () => {
    expect(scrubText("Could not find jane.doe@gmail.com")).toBe("Could not find [email]");
    expect(scrubText("account 123456789012 failed")).toBe("account [number] failed");
    expect(scrubText("tx 6f8b0f0e-1234-4abc-8def-1234567890ab missing")).toBe("tx [id] missing");
  });
  it("leaves short numbers and ordinary words", () => {
    expect(scrubText("row 42 of 500: bad date")).toBe("row 42 of 500: bad date");
  });
});

describe("pathOnly", () => {
  it("drops the origin, the query and the hash", () => {
    expect(pathOnly("https://finsense.app/transactions?search=salary#top")).toBe("/transactions");
    expect(pathOnly("/api/accounts/6f8b0f0e-1234-4abc-8def-1234567890ab")).toBe("/api/accounts/[id]");
    expect(pathOnly(null)).toBeNull();
    expect(pathOnly("")).toBeNull();
  });
});

describe("fingerprintOf", () => {
  const base = { source: "client", message: "Cannot read properties of undefined (reading 'x')", url: "https://a.test/budgets?m=1" };

  it("is the same for the same error, whatever the query string", () => {
    expect(fingerprintOf(base)).toBe(fingerprintOf({ ...base, url: "https://a.test/budgets?m=2" }));
  });
  it("groups errors that only differ in ids and numbers", () => {
    const a = fingerprintOf({ source: "server", message: "Account 6f8b0f0e-1234-4abc-8def-1234567890ab not found" });
    const b = fingerprintOf({ source: "server", message: "Account 11111111-2222-4333-8444-555555555555 not found" });
    expect(a).toBe(b);
  });
  it("differs by source, message and page", () => {
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, source: "server" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, message: "Something else" }));
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, url: "https://a.test/goals" }));
  });
  it("is a short hex string", () => expect(fingerprintOf(base)).toMatch(/^[0-9a-f]{32}$/));
});
