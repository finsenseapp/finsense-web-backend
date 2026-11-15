import { z } from "zod";
import { isDateOnly, parseDateInput } from "../../utils/dates.js";
import { env } from "../../config/env.js";

/**
 * range = week | month | year (default month). All other values are optional and default to the current period
 * in APP_TIMEZONE: month + year for "month", year for "year", weekStart (any date in the week; snapped to its Monday) for "week".
 */
export const summaryQuerySchema = z.object({
  range: z.enum(["week", "month", "year"]).default("month"),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  weekStart: z
    .string()
    .refine((v) => isDateOnly(v) && parseDateInput(v, env.APP_TIMEZONE) !== null, "weekStart must be a valid YYYY-MM-DD date")
    .optional(),
});

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
