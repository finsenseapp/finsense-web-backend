import { z } from "zod";
import { isSupportedCurrency } from "../../utils/currencies.js";
import { moneySchema } from "../../utils/money.js";
import { paginationSchema } from "../../utils/pagination.js";

const accountType = z.enum(["BANK", "CASH", "CREDIT_CARD", "E_WALLET"]);
const name = z.string().trim().min(1, "Name is required").max(100);

export const createAccountSchema = z.object({
  name,
  type: accountType,
  /** The currency the account holds (LKR by default). It cannot be changed later: every balance and transaction depends on it. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isSupportedCurrency, "Choose a supported currency code, like LKR or USD")
    .default("LKR"),
  /** In the account's own currency. */
  openingBalance: moneySchema.default("0"),
});

// .strict(): sending "balance" (or any unknown field) is rejected, not silently ignored.
export const updateAccountSchema = z
  .object({
    name: name.optional(),
    type: accountType.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const accountIdParamsSchema = z.object({ id: z.uuid() });

export const listAccountsQuerySchema = paginationSchema(50, 100);

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
