import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { isoDateInZone } from "../utils/dates.js";
import { isSupportedCurrency } from "../utils/currencies.js";
import { AppError } from "../utils/errors.js";
import { Decimal } from "../utils/money.js";
import { getRates } from "./ratesService.js";

/**
 * Exchange rates for a past day, so a transaction keeps the value it really had when it happened instead of being
 * re-valued with today's rate every time. Source: the free, keyless currency-api dataset (daily snapshots from 2024).
 * Each day is fetched once and kept in the database. For a date the source does not have (older than its archive, or
 * a failed request) the latest rate is used instead and the problem is only logged: a transaction is never refused
 * because a rate service is down.
 */
const URL_FOR = (iso: string) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${iso}/v1/currencies/lkr.json`;
const FETCH_TIMEOUT_MS = 8000;

const memory = new Map<string, Record<string, number>>();

/** Units of each currency per 1 LKR, from the provider's lower-case JSON. Only real, supported currency codes. Exported for tests. */
export function parseDayRates(json: unknown): Record<string, number> {
  const source = (json as { lkr?: Record<string, unknown> } | null)?.lkr;
  if (!source || typeof source !== "object") throw new Error("Unexpected rates format");
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(source)) {
    const upper = code.toUpperCase();
    if (/^[A-Z]{3}$/.test(upper) && isSupportedCurrency(upper) && typeof value === "number" && Number.isFinite(value) && value > 0) {
      rates[upper] = value;
    }
  }
  rates.LKR = 1;
  return rates;
}

async function latest(): Promise<Record<string, number>> {
  return (await getRates()).rates;
}

/** The rates on one day (YYYY-MM-DD). Today and the future use the latest rates. */
export async function ratesForDate(iso: string): Promise<Record<string, number>> {
  if (iso >= isoDateInZone(new Date(), env.APP_TIMEZONE)) return latest();

  const cached = memory.get(iso);
  if (cached) return cached;

  const stored = await prisma.dayRates.findUnique({ where: { date: iso } });
  if (stored) {
    const rates = stored.rates as Record<string, number>;
    memory.set(iso, rates);
    return rates;
  }

  try {
    const res = await fetch(URL_FOR(iso), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`rates for ${iso}: provider answered ${res.status}`);
    const rates = parseDayRates(await res.json());
    await prisma.dayRates.upsert({ where: { date: iso }, create: { date: iso, rates }, update: { rates } });
    memory.set(iso, rates);
    return rates;
  } catch (err) {
    console.error(`No historical rates for ${iso}, using the latest instead:`, err instanceof Error ? err.message : err);
    return latest(); // not cached: a later request may succeed
  }
}

/** LKR per 1 unit of `currency` on `iso`, to 8 decimals. */
export async function lkrPerUnit(currency: string, iso: string): Promise<Decimal> {
  if (currency === "LKR") return new Decimal(1);
  const perLkr = (await ratesForDate(iso))[currency];
  if (!perLkr) throw new AppError(400, "NO_EXCHANGE_RATE", `There is no exchange rate for ${currency} right now. Please try again shortly.`);
  return new Decimal(1).div(perLkr).toDecimalPlaces(8);
}
