import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Money input: a string or a number with at most 2 decimal places.
 * Fits Decimal(14, 2): up to 12 integer digits. The value is kept as a
 * string so it can be handed to Prisma.Decimal without float arithmetic.
 */
const MONEY_REGEX = /^-?\d{1,12}(\.\d{1,2})?$/;

const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
  .refine((v) => MONEY_REGEX.test(v), {
    message: "Must be a valid amount with at most 2 decimal places",
  });

/** Signed money amount (e.g. an opening balance, which can be negative). */
export const moneySchema = moneyString;

/** Strictly positive money amount (e.g. a transaction amount). */
export const positiveMoneySchema = moneyString.refine((v) => Number(v) > 0, {
  message: "Amount must be greater than zero",
});

/** Exact decimal arithmetic (decimal.js via Prisma). Never use JS floats for money. */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** Sum a list of decimal-like values exactly. */
export function sumMoney(values: Array<Decimal | string | number>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

/** Format a Prisma Decimal (or anything with toFixed) as a "1250.00" string. */
export function formatMoney(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2);
}
