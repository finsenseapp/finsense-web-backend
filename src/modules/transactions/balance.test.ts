import { describe, expect, it } from "vitest";
import {
  computeBalanceEffects,
  computeDeleteEffects,
  computeUpdateEffects,
  mergeEffects,
  type BalanceEffect,
  type BalanceTx,
} from "./balance.js";

/** Plain { accountId: "123.45" } view so assertions are readable and exact. */
const view = (effects: BalanceEffect[]) =>
  Object.fromEntries(effects.map((e) => [e.accountId, e.delta.toFixed(2)]));

describe("computeBalanceEffects", () => {
  it("INCOME adds to the account", () => {
    const fx = computeBalanceEffects({ type: "INCOME", accountId: "A", amount: "50000" });
    expect(view(fx)).toEqual({ A: "50000.00" });
  });

  it("EXPENSE subtracts from the account", () => {
    const fx = computeBalanceEffects({ type: "EXPENSE", accountId: "A", amount: "2500.50" });
    expect(view(fx)).toEqual({ A: "-2500.50" });
  });

  it("TRANSFER subtracts from the source and adds to the destination", () => {
    const fx = computeBalanceEffects({
      type: "TRANSFER",
      accountId: "A",
      toAccountId: "B",
      amount: 5000,
    });
    expect(view(fx)).toEqual({ A: "-5000.00", B: "5000.00" });
  });

  it("TRANSFER without a destination throws", () => {
    expect(() => computeBalanceEffects({ type: "TRANSFER", accountId: "A", amount: "1" })).toThrow();
  });

  it("is exact where JS floats are not (0.1 + 0.2)", () => {
    const fx = mergeEffects(
      computeBalanceEffects({ type: "INCOME", accountId: "A", amount: "0.10" }),
      computeBalanceEffects({ type: "INCOME", accountId: "A", amount: "0.20" }),
    );
    expect(view(fx)).toEqual({ A: "0.30" });
    expect(0.1 + 0.2).not.toBe(0.3); // the bug we avoid
  });
});

describe("computeUpdateEffects (reverse old + apply new)", () => {
  const expense = (amount: string, accountId = "A"): BalanceTx => ({
    type: "EXPENSE",
    accountId,
    amount,
  });

  it("amount change: only the difference is applied", () => {
    // 2500 -> 3000 expense: balance must drop a further 500
    expect(view(computeUpdateEffects(expense("2500"), expense("3000")))).toEqual({ A: "-500.00" });
  });

  it("amount decrease gives money back", () => {
    expect(view(computeUpdateEffects(expense("3000"), expense("2000")))).toEqual({ A: "1000.00" });
  });

  it("no change nets to nothing", () => {
    expect(computeUpdateEffects(expense("2500"), expense("2500"))).toEqual([]);
  });

  it("type change EXPENSE -> INCOME flips the sign (2x amount)", () => {
    const fx = computeUpdateEffects(expense("1000"), { type: "INCOME", accountId: "A", amount: "1000" });
    expect(view(fx)).toEqual({ A: "2000.00" });
  });

  it("account change moves the effect between accounts", () => {
    const fx = computeUpdateEffects(expense("1000", "A"), expense("1000", "B"));
    expect(view(fx)).toEqual({ A: "1000.00", B: "-1000.00" });
  });

  it("EXPENSE -> TRANSFER", () => {
    const fx = computeUpdateEffects(expense("1000", "A"), {
      type: "TRANSFER",
      accountId: "A",
      toAccountId: "B",
      amount: "1000",
    });
    // A: +1000 (undo expense) -1000 (transfer out) = 0 -> dropped; B: +1000
    expect(view(fx)).toEqual({ B: "1000.00" });
  });

  it("TRANSFER -> EXPENSE", () => {
    const fx = computeUpdateEffects(
      { type: "TRANSFER", accountId: "A", toAccountId: "B", amount: "1000" },
      expense("1000", "A"),
    );
    expect(view(fx)).toEqual({ B: "-1000.00" });
  });

  it("TRANSFER destination change", () => {
    const fx = computeUpdateEffects(
      { type: "TRANSFER", accountId: "A", toAccountId: "B", amount: "500" },
      { type: "TRANSFER", accountId: "A", toAccountId: "C", amount: "500" },
    );
    expect(view(fx)).toEqual({ B: "-500.00", C: "500.00" });
  });

  it("TRANSFER direction swap", () => {
    const fx = computeUpdateEffects(
      { type: "TRANSFER", accountId: "A", toAccountId: "B", amount: "500" },
      { type: "TRANSFER", accountId: "B", toAccountId: "A", amount: "500" },
    );
    expect(view(fx)).toEqual({ A: "1000.00", B: "-1000.00" });
  });
});

describe("computeDeleteEffects", () => {
  it("deleting an expense gives the money back", () => {
    expect(view(computeDeleteEffects({ type: "EXPENSE", accountId: "A", amount: "2500" }))).toEqual({
      A: "2500.00",
    });
  });

  it("deleting a transfer reverses both sides", () => {
    const fx = computeDeleteEffects({ type: "TRANSFER", accountId: "A", toAccountId: "B", amount: "5000" });
    expect(view(fx)).toEqual({ A: "5000.00", B: "-5000.00" });
  });
});

describe("mergeEffects", () => {
  it("sums per account and drops zero results", () => {
    const fx = mergeEffects(
      computeBalanceEffects({ type: "INCOME", accountId: "A", amount: "100" }),
      computeBalanceEffects({ type: "EXPENSE", accountId: "A", amount: "100" }),
      computeBalanceEffects({ type: "INCOME", accountId: "B", amount: "7.25" }),
    );
    expect(view(fx)).toEqual({ B: "7.25" });
  });
});
