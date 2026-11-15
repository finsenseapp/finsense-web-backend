import { z } from "zod";
import { AppError } from "../utils/errors.js";

/**
 * Exchange rates. All FinSense amounts are stored in LKR (the base currency); the app converts them
 * for display with these rates. Source: open.er-api.com (free, no key, refreshed about once a day).
 */
const RATES_URL = "https://open.er-api.com/v6/latest/LKR";
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 8000;

const providerSchema = z.object({
  result: z.literal("success"),
  base_code: z.literal("LKR"),
  time_last_update_unix: z.number(),
  rates: z.record(z.string(), z.number().positive()),
});

export interface RatesPayload {
  base: "LKR";
  /** 1 LKR = rates[code] units of that currency. */
  rates: Record<string, number>;
  /** When the provider last updated the rates (ISO). */
  updatedAt: string;
  source: string;
}

/** Validates the provider response and keeps only usable 3-letter codes. Exported for tests. */
export function parseProviderResponse(json: unknown): RatesPayload {
  const parsed = providerSchema.parse(json);
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(parsed.rates)) {
    if (/^[A-Z]{3}$/.test(code)) rates[code] = rate;
  }
  rates.LKR = 1;
  return {
    base: "LKR",
    rates,
    updatedAt: new Date(parsed.time_last_update_unix * 1000).toISOString(),
    source: "exchangerate-api.com",
  };
}

let cache: { payload: RatesPayload; fetchedAt: number } | null = null;
let inflight: Promise<RatesPayload> | null = null;

async function fetchRates(): Promise<RatesPayload> {
  const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Rates provider answered ${res.status}`);
  return parseProviderResponse(await res.json());
}

/** Cached for 6 hours. If the provider is down, the last good rates are served; with none, a 502. */
export async function getRates(): Promise<RatesPayload> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.payload;

  inflight ??= fetchRates().finally(() => {
    inflight = null;
  });

  try {
    const payload = await inflight;
    cache = { payload, fetchedAt: Date.now() };
    return payload;
  } catch {
    if (cache) return cache.payload;
    throw new AppError(502, "RATES_UNAVAILABLE", "Exchange rates are unavailable right now. Please try again shortly.");
  }
}
