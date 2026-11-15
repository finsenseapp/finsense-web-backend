import { monthRange, yearMonthInZone, zonedTimeToUtc } from "../../utils/dates.js";
import { Decimal } from "../../utils/money.js";

/**
 * Percentage change from `previous` to `current`, rounded to 1 decimal: (current - previous) / |previous| * 100.
 * Returns null when there is nothing to compare against (previous is zero), so the UI can show "new" instead of a
 * meaningless infinity. Exact Decimal maths, no floats until the final display number.
 */
export function percentChange(current: Decimal | string | number, previous: Decimal | string | number): number | null {
  const prev = new Decimal(previous);
  if (prev.isZero()) return null;
  return new Decimal(current).minus(prev).div(prev.abs()).times(100).toDecimalPlaces(1).toNumber();
}

/** The calendar month before (year, month). */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// ------------------------------------------------------------------ periods

export type DashboardRange = "week" | "month" | "year";

export interface ResolvedPeriod {
  range: DashboardRange;
  year: number;
  /** Month of the period's first day (for a year: January). Budgets are monthly, so the UI uses it to pick a month. */
  month: number;
  /** The Monday that starts the week (week range only). */
  weekStart: string | null;
  /** [from, to) of the period and of the one before it (same length), as UTC instants. */
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of a calendar date given as UTC parts (day overflow rolls over, so d + 7 works). */
function isoFromUtc(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return isoFromUtc(y, m, d + days);
}

/** The Monday on or before a date (weeks run Monday to Sunday). */
export function mondayOnOrBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysIso(iso, -((weekday + 6) % 7));
}

function startOfIsoDay(iso: string, tz: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return zonedTimeToUtc(y, m, d, tz);
}

/** Which instants a dashboard request covers. Missing values default to the current week / month / year in `tz`. */
export function resolvePeriod(
  q: { range: DashboardRange; month?: number; year?: number; weekStart?: string },
  tz: string,
  now: Date = new Date(),
): ResolvedPeriod {
  const today = yearMonthInZone(now, tz);

  if (q.range === "year") {
    const year = q.year ?? today.year;
    return {
      range: "year",
      year,
      month: 1,
      weekStart: null,
      from: zonedTimeToUtc(year, 1, 1, tz),
      to: zonedTimeToUtc(year + 1, 1, 1, tz),
      prevFrom: zonedTimeToUtc(year - 1, 1, 1, tz),
      prevTo: zonedTimeToUtc(year, 1, 1, tz),
    };
  }

  if (q.range === "week") {
    const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const weekStart = mondayOnOrBefore(q.weekStart ?? todayIso);
    const from = startOfIsoDay(weekStart, tz);
    const { year, month } = yearMonthInZone(from, tz);
    return {
      range: "week",
      year,
      month,
      weekStart,
      from,
      to: startOfIsoDay(addDaysIso(weekStart, 7), tz),
      prevFrom: startOfIsoDay(addDaysIso(weekStart, -7), tz),
      prevTo: from,
    };
  }

  const year = q.year ?? today.year;
  const month = q.month ?? today.month;
  const cur = monthRange(year, month, tz);
  const prev = previousMonth(year, month);
  const prevRange = monthRange(prev.year, prev.month, tz);
  return { range: "month", year, month, weekStart: null, ...cur, prevFrom: prevRange.from, prevTo: prevRange.to };
}
