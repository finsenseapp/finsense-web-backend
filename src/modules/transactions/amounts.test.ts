import { describe, expect, it } from "vitest";
import { Decimal } from "../../utils/money.js";
import { computeAmounts } from "./amounts.js";
import { computeBalanceEffects, computeUpdateEffects } from "./balance.js";

const rate = (v: string) => new Decimal(v);

describe("computeAmounts", () => {
  it("an LKR account changes nothing: the amount is the amount", () => {
    const a = computeAmounts({ native: "2500.50", accountCurrency: "LKR", rateFrom: null });
    expect(a.amount.toFixed(2)).toBe("2500.50");
    expect(a.accountAmount).toBeNull();
    expect(a.toAmount).toBeNull();
    expect(a.rate).toBeNull();
  });

  it("a foreign account keeps the typed amount exactly and values it in LKR at that day's rate", () => {
    const a = computeAmounts({ native: "100.00", accountCurrency: "USD", rateFrom: rate("324.5612") });
    expect(a.accountAmount?.toFixed(2)).toBe("100.00");
    expect(a.amount.toFixed(2)).toBe("32456.12");
    expect(a.rate?.toString()).toBe("324.5612");
  });

  it("the LKR value is rounded to cents, the foreign amount never is", () => {
    const a = computeAmounts({ native: "33.33", accountCurrency: "EUR", rateFrom: rate("357.14285714") });
    expect(a.accountAmount?.toFixed(2)).toBe("33.33"); // exactly what was typed
    expect(a.amount.toFixed(2)).toBe("11903.57"); // 33.33 x 357.14285714 = 11903.5714...
  });

  it("a different day's rate gives a different LKR value for the same foreign amount", () => {
    const old = computeAmounts({ native: "100", accountCurrency: "USD", rateFrom: rate("300") });
    const recent = computeAmounts({ native: "100", accountCurrency: "USD", rateFrom: rate("325") });
    expect(old.amount.toFixed(2)).toBe("30000.00");
    expect(recent.amount.toFixed(2)).toBe("32500.00");
  });

  it("transfer LKR to USD: the destination gets the converted amount", () => {
    const a = computeAmounts({ native: "32500", accountCurrency: "LKR", toCurrency: "USD", rateFrom: null, rateTo: rate("325") });
    expect(a.amount.toFixed(2)).toBe("32500.00");
    expect(a.toAmount?.toFixed(2)).toBe("100.00");
  });

  it("transfer USD to LKR: the destination gets the LKR value (toAmount stays null, it equals amount)", () => {
    const a = computeAmounts({ native: "100", accountCurrency: "USD", toCurrency: "LKR", rateFrom: rate("325") });
    expect(a.accountAmount?.toFixed(2)).toBe("100.00");
    expect(a.amount.toFixed(2)).toBe("32500.00");
    expect(a.toAmount).toBeNull();
  });

  it("transfer between two accounts of the same foreign currency moves exactly the same number", () => {
    const a = computeAmounts({ native: "123.45", accountCurrency: "USD", toCurrency: "USD", rateFrom: rate("325.123"), rateTo: rate("325.123") });
    expect(a.toAmount?.toFixed(2)).toBe("123.45");
  });

  it("transfer USD to EUR goes through LKR", () => {
    const a = computeAmounts({ native: "100", accountCurrency: "USD", toCurrency: "EUR", rateFrom: rate("325"), rateTo: rate("357.5") });
    expect(a.amount.toFixed(2)).toBe("32500.00");
    expect(a.toAmount?.toFixed(2)).toBe("90.91"); // 32500 / 357.5
  });
});

describe("balance effects with foreign amounts", () => {
  it("a foreign account moves by its own currency, not by the LKR value", () => {
    const a = computeAmounts({ native: "100", accountCurrency: "USD", rateFrom: rate("325") });
    const [effect] = computeBalanceEffects({ type: "EXPENSE", accountId: "usd", amount: a.amount, accountAmount: a.accountAmount, toAmount: a.toAmount });
    expect(effect?.delta.toFixed(2)).toBe("-100.00");
  });

  it("a cross-currency transfer takes the source currency out and puts the destination currency in", () => {
    const a = computeAmounts({ native: "32500", accountCurrency: "LKR", toCurrency: "USD", rateFrom: null, rateTo: rate("325") });
    const effects = computeBalanceEffects({ type: "TRANSFER", accountId: "lkr", toAccountId: "usd", amount: a.amount, accountAmount: a.accountAmount, toAmount: a.toAmount });
    expect(effects.find((e) => e.accountId === "lkr")?.delta.toFixed(2)).toBe("-32500.00");
    expect(effects.find((e) => e.accountId === "usd")?.delta.toFixed(2)).toBe("100.00");
  });

  it("LKR-only transactions behave exactly as before (no foreign fields)", () => {
    const effects = computeBalanceEffects({ type: "TRANSFER", accountId: "a", toAccountId: "b", amount: "500" });
    expect(effects.map((e) => `${e.accountId}:${e.delta.toFixed(2)}`)).toEqual(["a:-500.00", "b:500.00"]);
  });

  it("editing a foreign transaction reverses the old foreign amount and applies the new one", () => {
    const old = { type: "EXPENSE" as const, accountId: "usd", amount: "32500", accountAmount: "100", toAmount: null };
    const next = { type: "EXPENSE" as const, accountId: "usd", amount: "16250", accountAmount: "50", toAmount: null };
    const [effect] = computeUpdateEffects(old, next);
    expect(effect?.delta.toFixed(2)).toBe("50.00"); // 100 given back, 50 taken
  });
});
