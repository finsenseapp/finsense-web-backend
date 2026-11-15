import { env } from "../../config/env.js";
import { isoDateInZone } from "../../utils/dates.js";
import { AppError } from "../../utils/errors.js";
import { Decimal } from "../../utils/money.js";
import { lkrPerUnit, ratesForDate } from "../../services/historicalRates.js";
import type { Prisma } from "../../generated/prisma/client.js";

export interface Amounts {
  /** The value in LKR, what dashboards and budgets add up. */
  amount: Decimal;
  /** Exact amount in the account's own currency (null for an LKR account). */
  accountAmount: Decimal | null;
  /** A transfer's credit to the destination, in its currency (null when that equals `amount`). */
  toAmount: Decimal | null;
  /** LKR per unit of the account's currency on the date (null for an LKR account). */
  rate: Decimal | null;
}

const lkr = (value: Decimal) => value.toDecimalPlaces(2);

/**
 * Works out every amount of a transaction from what the user typed, which is always in the currency of the account it
 * is booked on. Pure, exact (Decimal): the typed amount is kept as it is; only the LKR value is rounded to cents.
 *
 *  - LKR account:      amount = typed, nothing else (exactly as before multi-currency existed).
 *  - foreign account:  accountAmount = typed, amount = typed x rate of that day.
 *  - transfer:         the destination gets the same value in its own currency (same currency: exactly the same number).
 */
export function computeAmounts(args: {
  native: Decimal | string | number;
  accountCurrency: string;
  toCurrency?: string | null;
  rateFrom: Decimal | null;
  rateTo?: Decimal | null;
}): Amounts {
  const native = new Decimal(args.native);
  const foreign = args.accountCurrency !== "LKR";
  if (foreign && !args.rateFrom) throw new Error("A rate is needed for a foreign account");

  const amount = foreign ? lkr(native.times(args.rateFrom!)) : native;
  const accountAmount = foreign ? native : null;
  const rate = foreign ? args.rateFrom! : null;

  let toAmount: Decimal | null = null;
  if (args.toCurrency && args.toCurrency !== "LKR") {
    if (args.toCurrency === args.accountCurrency) toAmount = native; // same currency in, same currency out: no conversion
    else {
      if (!args.rateTo) throw new Error("A rate is needed for the destination account");
      toAmount = lkr(amount.div(args.rateTo));
    }
  }
  return { amount, accountAmount, toAmount, rate };
}

type Db = Prisma.TransactionClient;

/** Reads the accounts' currencies and the day's rates, then computes the amounts. The accounts must belong to the user. */
export async function resolveAmounts(
  db: Db,
  userId: string,
  args: { accountId: string; toAccountId?: string | null; native: Decimal | string | number; date: Date },
): Promise<Amounts> {
  const ids = [args.accountId, ...(args.toAccountId ? [args.toAccountId] : [])];
  const accounts = await db.account.findMany({ where: { userId, id: { in: ids } }, select: { id: true, currency: true } });
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const from = currencyOf.get(args.accountId);
  if (!from) throw AppError.notFound("Account not found");
  const to = args.toAccountId ? currencyOf.get(args.toAccountId) : null;
  if (args.toAccountId && !to) throw AppError.notFound("Account not found");

  const iso = isoDateInZone(args.date, env.APP_TIMEZONE);
  return computeAmounts({
    native: args.native,
    accountCurrency: from,
    toCurrency: to ?? null,
    rateFrom: from === "LKR" ? null : await lkrPerUnit(from, iso),
    rateTo: to && to !== "LKR" ? await lkrPerUnit(to, iso) : null,
  });
}

/**
 * Fetches the rates of these days now (one request per day, then cached), so no network call happens later while a
 * database transaction is open. Does nothing when every account involved is in LKR.
 */
export async function warmRates(db: Db, userId: string, accountIds: (string | null | undefined)[], dates: Date[]): Promise<void> {
  const ids = [...new Set(accountIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const foreign = await db.account.count({ where: { userId, id: { in: ids }, currency: { not: "LKR" } } });
  if (foreign === 0) return;
  const days = [...new Set(dates.map((d) => isoDateInZone(d, env.APP_TIMEZONE)))];
  for (const iso of days) await ratesForDate(iso);
}
