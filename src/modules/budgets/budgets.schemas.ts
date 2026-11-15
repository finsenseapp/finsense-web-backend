import { z } from "zod";
import { positiveMoneySchema } from "../../utils/money.js";
import { paginationSchema } from "../../utils/pagination.js";

const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);

export const createBudgetSchema = z.object({
  categoryId: z.uuid(),
  amountLimit: positiveMoneySchema,
  month,
  year,
});

// Only the limit can change. The category and month define the budget, so to move one: delete and re-create.
export const updateBudgetSchema = z.object({ amountLimit: positiveMoneySchema }).strict();

export const budgetIdParamsSchema = z.object({ id: z.uuid() });

// month / year default to the current month in APP_TIMEZONE
export const listBudgetsQuerySchema = paginationSchema(100, 200).extend({
  month: month.optional(),
  year: year.optional(),
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
export type ListBudgetsQuery = z.infer<typeof listBudgetsQuerySchema>;
