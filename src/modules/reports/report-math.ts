import { ymdInZone } from "../../utils/dates.js";
import { Decimal } from "../../utils/money.js";

/** "2026-11" keys of the last `months` calendar months in `tz`, oldest first, ending with the month of `now`. */
export function lastMonthKeys(now: Date, months: number, tz: string): string[] {
  const { year, month } = ymdInZone(now, tz);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const index = year * 12 + (month - 1) - i;
    keys.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Net worth at the end of each month, worked backwards from today's total: a month's end value is today's total minus
 * everything earned and spent after it (income minus expenses of the later months). Transfers between a user's own
 * accounts do not change net worth. Exchange-rate movements of foreign balances are not included in the history.
 */
export function netWorthSeries(currentTotal: Decimal | string, monthKeys: string[], flowByMonth: Map<string, Decimal>): Decimal[] {
  const out: Decimal[] = new Array(monthKeys.length);
  let running = new Decimal(currentTotal);
  for (let i = monthKeys.length - 1; i >= 0; i--) {
    out[i] = running;
    running = running.minus(flowByMonth.get(monthKeys[i]!) ?? new Decimal(0));
  }
  return out;
}

/** Share of income that was not spent, in percent with one decimal. Null when there was no income to save from. */
export function savingsRate(income: Decimal | string, expenses: Decimal | string): number | null {
  const inc = new Decimal(income);
  if (inc.lessThanOrEqualTo(0)) return null;
  return inc.minus(expenses).div(inc).times(100).toDecimalPlaces(1).toNumber();
}
