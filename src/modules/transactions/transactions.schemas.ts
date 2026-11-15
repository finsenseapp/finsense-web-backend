import { z } from "zod";
import { env } from "../../config/env.js";
import { parseDateInput, parseRangeEnd } from "../../utils/dates.js";
import { positiveMoneySchema } from "../../utils/money.js";
import { paginationSchema } from "../../utils/pagination.js";

const txType = z.enum(["INCOME", "EXPENSE", "TRANSFER"]);

/** "YYYY-MM-DD" (start of that day in APP_TIMEZONE) or a full ISO date-time. */
const dateInput = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const date = parseDateInput(value, env.APP_TIMEZONE);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Must be a valid date (YYYY-MM-DD or ISO date-time)" });
      return z.NEVER;
    }
    return date;
  });

const description = z.string().trim().min(1, "Description is required").max(255);
const rawDescription = z.string().trim().max(500);
const merchantName = z.string().trim().max(120);
const aiConfidence = z.number().min(0).max(1);

export interface ShapeFields {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
}

/** Business rules for INCOME/EXPENSE vs TRANSFER (CLAUDE.md section 5). */
export function shapeIssues(t: ShapeFields): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (t.type === "TRANSFER") {
    if (!t.toAccountId) issues.push({ path: "toAccountId", message: "toAccountId is required for a transfer" });
    else if (t.toAccountId === t.accountId) {
      issues.push({ path: "toAccountId", message: "toAccountId must differ from accountId" });
    }
    if (t.categoryId) issues.push({ path: "categoryId", message: "A transfer cannot have a category" });
  } else {
    if (!t.categoryId) issues.push({ path: "categoryId", message: "categoryId is required" });
    if (t.toAccountId) issues.push({ path: "toAccountId", message: "Only a transfer can have toAccountId" });
  }
  return issues;
}

export const createTransactionSchema = z
  .object({
    type: txType,
    accountId: z.uuid(),
    toAccountId: z.uuid().nullish(),
    categoryId: z.uuid().nullish(),
    amount: positiveMoneySchema,
    description,
    rawDescription: rawDescription.nullish(),
    merchantName: merchantName.nullish(),
    aiConfidence: aiConfidence.nullish(),
    date: dateInput,
  })
  .superRefine((v, ctx) => {
    for (const issue of shapeIssues(v)) {
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
  });

// Partial update. The merged result is re-validated in the service.
export const updateTransactionSchema = z
  .object({
    type: txType,
    accountId: z.uuid(),
    toAccountId: z.uuid().nullable(),
    categoryId: z.uuid().nullable(),
    amount: positiveMoneySchema,
    description,
    rawDescription: rawDescription.nullable(),
    merchantName: merchantName.nullable(),
    aiConfidence: aiConfidence.nullable(),
    date: dateInput,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });

export const transactionIdParamsSchema = z.object({ id: z.uuid() });

const rangeStart = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const d = parseDateInput(v, env.APP_TIMEZONE);
    if (!d) ctx.addIssue({ code: "custom", message: "Must be a valid date (YYYY-MM-DD or ISO date-time)" });
    return d ?? z.NEVER;
  });

const rangeEnd = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const d = parseRangeEnd(v, env.APP_TIMEZONE);
    if (!d) ctx.addIssue({ code: "custom", message: "Must be a valid date (YYYY-MM-DD or ISO date-time)" });
    return d ?? z.NEVER;
  });

export const listTransactionsQuerySchema = paginationSchema(20, 100).extend({
  from: rangeStart.optional(),
  to: rangeEnd.optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  type: txType.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

/** The same filters as the list, without paging, plus the file format. */
export const exportQuerySchema = listTransactionsQuerySchema.omit({ page: true, pageSize: true }).extend({
  format: z.enum(["csv", "pdf"]).default("csv"),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;

const bulkRow = z.object({
  date: dateInput,
  description,
  amount: positiveMoneySchema,
  type: z.enum(["INCOME", "EXPENSE"]),
  categoryId: z.uuid(),
  rawDescription: rawDescription.nullish(),
  merchantName: merchantName.nullish(),
  aiConfidence: aiConfidence.nullish(),
});

export const bulkTransactionsSchema = z.object({
  accountId: z.uuid(),
  transactions: z.array(bulkRow).min(1, "Provide at least one transaction").max(500, "At most 500 transactions per import"),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type BulkTransactionsInput = z.infer<typeof bulkTransactionsSchema>;

const splitPart = z.object({
  categoryId: z.uuid(),
  amount: positiveMoneySchema,
  /** Optional label for this part, added to the description ("Groceries - milk and bread"). */
  note: z.string().trim().max(100).nullish(),
});

/** One purchase divided across 2 to 10 categories. The total is simply the sum of the parts. */
export const splitTransactionSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  accountId: z.uuid(),
  description,
  date: dateInput,
  parts: z.array(splitPart).min(2, "A split needs at least two parts").max(10, "A split can have at most 10 parts"),
});
export const splitGroupParamsSchema = z.object({ groupId: z.uuid() });
export const attachmentParamsSchema = z.object({ id: z.uuid(), attachmentId: z.uuid() });

export type SplitTransactionInput = z.infer<typeof splitTransactionSchema>;
