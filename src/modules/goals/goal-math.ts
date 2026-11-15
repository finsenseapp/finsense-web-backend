import { ymdInZone } from "../../utils/dates.js";
import { Decimal } from "../../utils/money.js";

export interface GoalProgress {
  /** 0-100+ (one decimal); more than 100 means the target was passed. */
  percentSaved: number;
  /** Still to save, never negative. */
  remaining: Decimal;
  achieved: boolean;
  /** Whole months from now to the target date (at least 1), or null with no date or a date that has passed. */
  monthsLeft: number | null;
  /** What to put aside each month to arrive on time: remaining / monthsLeft, rounded up to the cent. */
  monthlyNeeded: Decimal | null;
}

/**
 * Where a goal stands. Pure and exact (Decimal): the percentage, what is left, and, when there is a target date, how
 * much to save each month to get there.
 */
export function goalProgress(
  target: Decimal | string | number,
  saved: Decimal | string | number,
  targetDate: Date | null,
  now: Date,
  tz: string,
): GoalProgress {
  const t = new Decimal(target);
  const s = new Decimal(saved);
  const remaining = Decimal.max(t.minus(s), 0);
  const achieved = s.greaterThanOrEqualTo(t);
  const percentSaved = t.isZero() ? 0 : s.div(t).times(100).toDecimalPlaces(1).toNumber();

  let monthsLeft: number | null = null;
  let monthlyNeeded: Decimal | null = null;
  if (targetDate && targetDate.getTime() > now.getTime()) {
    const a = ymdInZone(now, tz);
    const b = ymdInZone(targetDate, tz);
    // Calendar months between today and the target date; a part month counts as a whole one, and it is at least 1.
    const months = (b.year - a.year) * 12 + (b.month - a.month) + (b.day > a.day ? 1 : 0);
    monthsLeft = Math.max(1, months);
    if (!achieved) monthlyNeeded = remaining.div(monthsLeft).toDecimalPlaces(2, Decimal.ROUND_UP);
  }
  return { percentSaved, remaining, achieved, monthsLeft, monthlyNeeded };
}
