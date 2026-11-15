import { z } from "zod";
import { env } from "../../config/env.js";
import { parseDateInput } from "../../utils/dates.js";
import { positiveMoneySchema } from "../../utils/money.js";

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date like 2027-03-15")
  .transform((value, ctx) => {
    const date = parseDateInput(value, env.APP_TIMEZONE);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Must be a valid date" });
      return z.NEVER;
    }
    return date;
  });

const name = z.string().trim().min(1, "Name is required").max(80);

export const createGoalSchema = z.object({
  name,
  targetAmount: positiveMoneySchema,
  targetDate: dateOnly.nullish(),
});

export const updateGoalSchema = z
  .object({ name, targetAmount: positiveMoneySchema, targetDate: dateOnly.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const contributionSchema = z.object({
  /** "ADD" puts money aside, "WITHDRAW" takes it back out. The amount itself is always positive. */
  kind: z.enum(["ADD", "WITHDRAW"]),
  amount: positiveMoneySchema,
  date: dateOnly.optional(),
  note: z.string().trim().max(200).nullish(),
});

export const goalIdParamsSchema = z.object({ id: z.uuid() });
export const contributionParamsSchema = z.object({ id: z.uuid(), contributionId: z.uuid() });

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type ContributionInput = z.infer<typeof contributionSchema>;
