import { describe, expect, it } from "vitest";
import { clip, periodRange, showLkr, showNative } from "./chatFormat.js";
import { chatSchema } from "./ai.schemas.js";

const tz = "Asia/Colombo";
const iso = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

describe("showLkr (what the assistant quotes)", () => {
  it("shows LKR as it is, with the code", () => {
    expect(showLkr("1250", { currency: "LKR", rates: null })).toBe("LKR 1,250.00");
    expect(showLkr("0", { currency: "LKR", rates: null })).toBe("LKR 0.00");
  });

  it("converts to the display currency with the given rate", () => {
    expect(showLkr("1000", { currency: "USD", rates: { USD: 0.003 } })).toBe("USD 3.00");
    expect(showLkr("33255.74", { currency: "USD", rates: { USD: 0.0030069 } })).toBe("USD 100.00");
  });

  it("falls back to LKR when the rate is unknown, so it never invents a conversion", () => {
    expect(showLkr("1000", { currency: "USD", rates: null })).toBe("LKR 1,000.00");
    expect(showLkr("1000", { currency: "XYZ", rates: { USD: 0.003 } })).toBe("LKR 1,000.00");
  });

  it("uses a plain space, not a non-breaking one", () => {
    expect(showLkr("5", { currency: "LKR", rates: null })).not.toMatch(/ /);
  });

  it("shows a foreign account's own amount unconverted", () => {
    expect(showNative("100.25", "USD")).toBe("USD 100.25");
    expect(showNative("-50", "EUR")).toBe("-EUR 50.00");
  });
});

describe("clip", () => {
  it("flattens line breaks and shortens, so a record cannot smuggle in a block of text", () => {
    expect(clip("POS   PURCHASE\n\nKEELLS")).toBe("POS PURCHASE KEELLS");
    expect(clip("x".repeat(200), 50)).toHaveLength(50);
    expect(clip(null)).toBe("");
  });
});

describe("periodRange", () => {
  const now = new Date("2026-11-15T10:00:00Z"); // Sunday 15 Nov 2026, Sri Lanka
  it("this and last week run Monday to Sunday", () => {
    const week = periodRange("this_week", now, tz);
    expect(iso(week.from)).toBe("2026-11-09");
    expect(iso(week.to)).toBe("2026-11-16");
    expect(iso(periodRange("last_week", now, tz).from)).toBe("2026-11-02");
  });
  it("this and last month", () => {
    expect(iso(periodRange("this_month", now, tz).from)).toBe("2026-11-01");
    expect(iso(periodRange("last_month", now, tz).from)).toBe("2026-10-01");
    expect(iso(periodRange("last_month", now, tz).to)).toBe("2026-11-01");
  });
  it("this and last year", () => {
    expect(iso(periodRange("this_year", now, tz).from)).toBe("2026-01-01");
    expect(iso(periodRange("last_year", now, tz).from)).toBe("2025-01-01");
  });
});

describe("chatSchema", () => {
  it("takes one message, trimmed", () => {
    expect(chatSchema.parse({ message: "  how much did I spend?  " }).message).toBe("how much did I spend?");
  });
  it("rejects empty, too long, and extra fields", () => {
    expect(chatSchema.safeParse({ message: "   " }).success).toBe(false);
    expect(chatSchema.safeParse({ message: "x".repeat(1001) }).success).toBe(false);
    expect(chatSchema.safeParse({ message: "hi", messages: [] }).success).toBe(false);
  });
});
