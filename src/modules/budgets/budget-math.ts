import { Decimal } from "../../utils/money.js";

export type BudgetStatus = "ok" | "warning" | "over";

/** A budget turns "warning" once 80% of the limit is used. */
export const WARNING_THRESHOLD_PERCENT = 80;

/**
 * Remaining amount, percentage used and status for one budget.
 * Pure and exact: all comparisons use Decimal, never JS floats.
 *   ok       spent < 80% of the limit
 *   warning  80% <= spent <= 100% of the limit
 *   over     spent > limit
 */
export function budgetProgress(limit: Decimal | string | number, spent: Decimal | string | number) {
  const l = new Decimal(limit);
  const s = new Decimal(spent);

  const remaining = l.minus(s); // negative when over budget
  const percentUsed = l.isZero() ? 0 : s.div(l).times(100).toDecimalPlaces(1).toNumber();

  let status: BudgetStatus = "ok";
  if (s.greaterThan(l)) status = "over";
  else if (s.times(100).greaterThanOrEqualTo(l.times(WARNING_THRESHOLD_PERCENT))) status = "warning";

  return { remaining, percentUsed, status };
}
