import { z } from "zod";
import { env } from "../../config/env.js";
import { parseDateInput } from "../../utils/dates.js";
import { positiveMoneySchema } from "../../utils/money.js";
import { shapeIssues } from "../transactions/transactions.schemas.js";

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date like 2026-12-01")
  .transform((value, ctx) => {
    const date = parseDateInput(value, env.APP_TIMEZONE);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Must be a valid date" });
      return z.NEVER;
    }
    return date;
  });

const description = z.string().trim().min(1, "Description is required").max(255);

export const createRecurringSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
    accountId: z.uuid(),
    toAccountId: z.uuid().nullish(),
    categoryId: z.uuid().nullish(),
    amount: positiveMoneySchema,
    description,
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.coerce.number().int().min(1).max(365).default(1),
    startDate: dateOnly,
    endDate: dateOnly.nullish(),
  })
  .superRefine((v, ctx) => {
    for (const issue of shapeIssues(v)) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    if (v.endDate && v.endDate.getTime() < v.startDate.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date must not be before the start date" });
    }
  });

/** What can change later: the account, type, frequency and start stay (delete and create a new rule to change those). */
export const updateRecurringSchema = z
  .object({
    description,
    amount: positiveMoneySchema,
    categoryId: z.uuid().nullable(),
    endDate: dateOnly.nullable(),
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const recurringIdParamsSchema = z.object({ id: z.uuid() });

export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;
