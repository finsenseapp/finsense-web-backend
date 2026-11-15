import { describe, expect, it } from "vitest";
import { maskEmail } from "./mask.js";

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
  });
  it("uses the last @ when the local part has one", () => {
    expect(maskEmail('"a@b"@example.com')).toBe('"***@example.com');
  });
  it("never leaks a value that is not an email", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("")).toBe("***");
    expect(maskEmail("@x.com")).toBe("***");
  });
});
