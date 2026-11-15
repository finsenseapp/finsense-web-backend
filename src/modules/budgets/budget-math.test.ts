import { describe, expect, it } from "vitest";
import { budgetProgress } from "./budget-math.js";

describe("budgetProgress", () => {
  it("nothing spent is ok at 0%", () => {
    const p = budgetProgress("10000", "0");
    expect(p.status).toBe("ok");
    expect(p.percentUsed).toBe(0);
    expect(p.remaining.toFixed(2)).toBe("10000.00");
  });

  it("just under 80% is still ok", () => {
    expect(budgetProgress("10000", "7999.99").status).toBe("ok");
  });

  it("exactly 80% is a warning", () => {
    const p = budgetProgress("10000", "8000");
    expect(p.status).toBe("warning");
    expect(p.percentUsed).toBe(80);
  });

  it("exactly 100% is still a warning, not over", () => {
    const p = budgetProgress("10000", "10000");
    expect(p.status).toBe("warning");
    expect(p.percentUsed).toBe(100);
    expect(p.remaining.toFixed(2)).toBe("0.00");
  });

  it("one cent over the limit is over, even though the rounded percentage reads 100", () => {
    const p = budgetProgress("10000", "10000.01");
    expect(p.status).toBe("over");
    expect(p.percentUsed).toBe(100);
    expect(p.remaining.toFixed(2)).toBe("-0.01");
  });

  it("well over budget reports a negative remainder and a large percentage", () => {
    const p = budgetProgress("5000", "12500.50");
    expect(p.status).toBe("over");
    expect(p.percentUsed).toBe(250);
    expect(p.remaining.toFixed(2)).toBe("-7500.50");
  });

  it("uses exact decimals (0.1 + 0.2 equals a 0.30 limit)", () => {
    expect(budgetProgress("0.30", "0.30").status).toBe("warning");
    expect(budgetProgress("0.30", 0.1 + 0.2).status).toBe("over"); // 0.30000000000000004 as a JS float: why we pass strings
  });

  it("a zero limit never divides by zero", () => {
    expect(budgetProgress("0", "0").percentUsed).toBe(0);
  });
});
