import { Decimal } from "../../utils/money.js";
import { resolvePeriod, type DashboardRange } from "../dashboard/dashboard-math.js";

export interface ToolContext {
  userId: string;
  /** The user's display currency (e.g. "LKR", "USD"). */
  currency: string;
  /** Units of each currency per 1 LKR, or null when unavailable (then amounts are shown in LKR). */
  rates: Record<string, number> | null;
}


const formatCode = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(value)
    .replace(/ /g, " ");

/** An LKR amount (decimal string or number) shown in the user's display currency, e.g. "USD 12.34" or "LKR 1,250.00". */
export function showLkr(lkr: Decimal | string | number, ctx: Pick<ToolContext, "currency" | "rates">): string {
  const n = new Decimal(lkr);
  const rate = ctx.currency === "LKR" ? 1 : ctx.rates?.[ctx.currency];
  if (!rate) return formatCode(n.toNumber(), "LKR");
  return formatCode(n.times(rate).toNumber(), ctx.currency);
}

/** An amount in a currency of its own, with no conversion. */
export const showNative = (value: string | number | Decimal, currency: string) => formatCode(new Decimal(value).toNumber(), currency);

/** Free text from the user's records, made safe to show a model: one line, short. */
export const clip = (text: string | null | undefined, max = 80): string => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// -------------------------------------------------------------------- periods

export const PERIODS = ["this_week", "last_week", "this_month", "last_month", "this_year", "last_year"] as const;
export type ToolPeriod = (typeof PERIODS)[number];

/** [from, to) of a named period in the app time zone. "last_*" is the period right before the current one. */
export function periodRange(period: ToolPeriod, now: Date, tz: string): { from: Date; to: Date } {
  const range = period.split("_")[1] as "week" | "month" | "year";
  const resolved = resolvePeriod({ range: range as DashboardRange }, tz, now);
  return period.startsWith("last_") ? { from: resolved.prevFrom, to: resolved.prevTo } : { from: resolved.from, to: resolved.to };
}
