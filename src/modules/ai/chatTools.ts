import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { isoDateInZone, parseDateInput, parseRangeEnd } from "../../utils/dates.js";
import { Decimal } from "../../utils/money.js";
export type { ToolContext } from "./chatFormat.js";
import { listAccounts, totalBalanceLkr } from "../accounts/accounts.service.js";
import { listBudgets } from "../budgets/budgets.service.js";
import { categoryVisibleTo } from "../categories/visibility.js";
import { listGoals } from "../goals/goals.service.js";
import { buildTransactionWhere, serializeTransaction, transactionInclude } from "../transactions/transactions.service.js";
import { clip, PERIODS, periodRange, showLkr, showNative, type ToolContext, type ToolPeriod } from "./chatFormat.js";

/**
 * What the assistant may look at. Every tool is read-only, runs for the signed-in user only (the user id comes from the
 * session on the server, never from the model), validates what the model sends, and returns small, already formatted
 * results. Money is formatted here in the user's display currency (field "shown"), so the model quotes numbers and
 * never does currency maths. Free text from the user's records is shortened and flattened: it is data, not instructions.
 */


const dateText = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Either a named period or an explicit from/to; this month by default. */
function rangeFrom(args: { period?: ToolPeriod | undefined; from?: string | undefined; to?: string | undefined }): { from: Date; to: Date } {
  if (args.from || args.to) {
    const from = args.from ? parseDateInput(args.from, env.APP_TIMEZONE) : new Date(0);
    const to = args.to ? parseRangeEnd(args.to, env.APP_TIMEZONE) : new Date(Date.now() + 86_400_000);
    if (!from || !to) throw new Error("Invalid date");
    return { from, to };
  }
  return periodRange(args.period ?? "this_month", new Date(), env.APP_TIMEZONE);
}

const rangeLabel = (r: { from: Date; to: Date }) => ({
  from: isoDateInZone(r.from, env.APP_TIMEZONE),
  to: isoDateInZone(new Date(r.to.getTime() - 1), env.APP_TIMEZONE),
});

// ----------------------------------------------------------------- lookups

async function categoryIdByName(userId: string, name: string): Promise<string> {
  const found = await prisma.category.findFirst({
    where: { ...categoryVisibleTo(userId), name: { equals: name.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (found) return found.id;
  const all = await prisma.category.findMany({ where: categoryVisibleTo(userId), select: { name: true }, orderBy: { name: "asc" }, take: 40 });
  throw new Error(`No category named "${clip(name, 40)}". The categories are: ${all.map((c) => c.name).join(", ")}`);
}

async function accountIdByName(userId: string, name: string): Promise<string> {
  const found = await prisma.account.findFirst({ where: { userId, name: { equals: name.trim(), mode: "insensitive" } }, select: { id: true } });
  if (found) return found.id;
  const all = await prisma.account.findMany({ where: { userId }, select: { name: true }, orderBy: { name: "asc" }, take: 40 });
  throw new Error(`No account named "${clip(name, 40)}". The accounts are: ${all.map((a) => a.name).join(", ")}`);
}

// ------------------------------------------------------------- argument shapes

const summaryArgs = z.object({
  period: z.enum(PERIODS).optional(),
  from: dateText.optional(),
  to: dateText.optional(),
  category: z.string().trim().min(1).max(60).optional(),
  type: z.enum(["EXPENSE", "INCOME"]).optional(),
});
const listArgs = z.object({
  limit: z.number().int().min(1).max(15).optional(),
  search: z.string().trim().min(1).max(60).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  account: z.string().trim().min(1).max(60).optional(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).optional(),
  from: dateText.optional(),
  to: dateText.optional(),
  sort: z.enum(["newest", "largest"]).optional(),
});
const budgetArgs = z.object({ month: z.number().int().min(1).max(12).optional(), year: z.number().int().min(2000).max(2100).optional() });
const noArgs = z.object({}).passthrough();

// ---------------------------------------------------------------------- tools

type Tool = { declaration: FunctionDeclaration; run: (ctx: ToolContext, args: unknown) => Promise<unknown> };

const tools: Record<string, Tool> = {
  get_spending_summary: {
    declaration: {
      name: "get_spending_summary",
      description:
        "Total income and expenses for a period, with the biggest expense categories. Use it for questions like 'how much did I spend this month' or 'how much on food last week'. Transfers are not income or expenses.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          period: { type: "string", enum: [...PERIODS], description: "A named period. Default this_month." },
          from: { type: "string", description: "Start date YYYY-MM-DD (use with 'to' instead of period)." },
          to: { type: "string", description: "End date YYYY-MM-DD, inclusive." },
          category: { type: "string", description: "Only this category, e.g. 'Food & Dining'." },
          type: { type: "string", enum: ["EXPENSE", "INCOME"], description: "Only expenses or only income." },
        },
      },
    },
    async run(ctx, raw) {
      const a = summaryArgs.parse(raw);
      const r = rangeFrom(a);
      const categoryId = a.category ? await categoryIdByName(ctx.userId, a.category) : undefined;
      const where = { userId: ctx.userId, date: { gte: r.from, lt: r.to }, type: a.type ?? { in: ["INCOME", "EXPENSE"] as const }, ...(categoryId ? { categoryId } : {}) };
      const [byType, byCategory] = await Promise.all([
        prisma.transaction.groupBy({ by: ["type"], where: { ...where, type: a.type ?? { in: ["INCOME", "EXPENSE"] } }, _sum: { amount: true }, _count: true }),
        prisma.transaction.groupBy({ by: ["categoryId"], where: { ...where, type: a.type ?? "EXPENSE", categoryId: categoryId ?? { not: null } }, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } }, take: 8 }),
      ]);
      const sum = (t: string) => byType.find((g) => g.type === t)?._sum.amount ?? new Decimal(0);
      const names = await prisma.category.findMany({ where: { id: { in: byCategory.map((c) => c.categoryId!).filter(Boolean) } }, select: { id: true, name: true } });
      const nameOf = new Map(names.map((c) => [c.id, c.name]));
      return {
        range: rangeLabel(r),
        income: showLkr(sum("INCOME"), ctx),
        expenses: showLkr(sum("EXPENSE"), ctx),
        net: showLkr(sum("INCOME").minus(sum("EXPENSE")), ctx),
        transactionCount: byType.reduce((n, g) => n + g._count, 0),
        ...(categoryId ? { filteredByCategory: a.category } : {}),
        topCategories: byCategory.map((c) => ({ category: nameOf.get(c.categoryId!) ?? "Unknown", shown: showLkr(c._sum.amount ?? 0, ctx) })),
      };
    },
  },

  list_transactions: {
    declaration: {
      name: "list_transactions",
      description:
        "The user's matching transactions, newest first or largest first, for questions like 'what was my last Keells purchase' or 'what was my biggest expense this month'. For 'biggest' or 'largest' use sort=largest (and combine with type, from and to).",
      parametersJsonSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "How many, 1 to 15. Default 10." },
          search: { type: "string", description: "Words in the description or merchant." },
          category: { type: "string" },
          account: { type: "string", description: "Account name." },
          type: { type: "string", enum: ["EXPENSE", "INCOME", "TRANSFER"] },
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD, inclusive" },
          sort: { type: "string", enum: ["newest", "largest"], description: "Default newest. Use largest for 'biggest'." },
        },
      },
    },
    async run(ctx, raw) {
      const a = listArgs.parse(raw);
      const [categoryId, accountId] = await Promise.all([
        a.category ? categoryIdByName(ctx.userId, a.category) : undefined,
        a.account ? accountIdByName(ctx.userId, a.account) : undefined,
      ]);
      const from = a.from ? parseDateInput(a.from, env.APP_TIMEZONE) : null;
      const to = a.to ? parseRangeEnd(a.to, env.APP_TIMEZONE) : null;
      const where = buildTransactionWhere(ctx.userId, {
        ...(a.search ? { search: a.search } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(accountId ? { accountId } : {}),
        ...(a.type ? { type: a.type } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      const [rows, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          include: transactionInclude,
          // "Largest" compares the LKR value, which is comparable across currencies.
          orderBy: a.sort === "largest" ? [{ amount: "desc" }, { date: "desc" }] : [{ date: "desc" }, { createdAt: "desc" }],
          take: a.limit ?? 10,
        }),
        prisma.transaction.count({ where }),
      ]);
      const res = { meta: { total }, data: rows.map(serializeTransaction) };
      return {
        total: res.meta.total,
        showing: res.data.length,
        sortedBy: a.sort ?? "newest",
        transactions: res.data.map((t) => ({
          date: isoDateInZone(t.date, env.APP_TIMEZONE),
          type: t.type,
          description: clip(t.merchantName || t.description),
          category: t.category?.name ?? null,
          account: t.account.name,
          shown: t.accountAmount ? showNative(t.accountAmount, t.accountCurrency) : showLkr(t.amount, ctx),
          ...(t.accountAmount ? { alsoInDisplayCurrency: showLkr(t.amount, ctx) } : {}),
        })),
      };
    },
  },

  get_account_balances: {
    declaration: {
      name: "get_account_balances",
      description: "The user's accounts with their balances and the total net balance.",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run(ctx, raw) {
      noArgs.parse(raw ?? {});
      const [accounts, total] = await Promise.all([listAccounts(ctx.userId, { page: 1, pageSize: 100 }), totalBalanceLkr(ctx.userId)]);
      return {
        total: showLkr(total, ctx),
        accounts: accounts.data.map((a) => ({
          name: clip(a.name, 60),
          type: a.type,
          balance: showNative(a.balance, a.currency),
          ...(a.currency !== "LKR" && a.balanceLkr ? { alsoInDisplayCurrency: showLkr(a.balanceLkr, ctx) } : {}),
        })),
      };
    },
  },

  get_budgets: {
    declaration: {
      name: "get_budgets",
      description: "The user's monthly budgets with how much is spent and left. Default: the current month.",
      parametersJsonSchema: { type: "object", properties: { month: { type: "integer" }, year: { type: "integer" } } },
    },
    async run(ctx, raw) {
      const a = budgetArgs.parse(raw ?? {});
      const res = await listBudgets(ctx.userId, { page: 1, pageSize: 50, ...(a.month ? { month: a.month } : {}), ...(a.year ? { year: a.year } : {}) });
      return {
        month: res.meta.month,
        year: res.meta.year,
        budgets: res.data.map((b) => ({
          category: b.category.name,
          limit: showLkr(b.amountLimit, ctx),
          spent: showLkr(b.spent, ctx),
          remaining: showLkr(b.remaining, ctx),
          percentUsed: b.percentUsed,
          status: b.status,
        })),
      };
    },
  },

  get_goals: {
    declaration: {
      name: "get_goals",
      description: "The user's savings goals with progress.",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run(ctx, raw) {
      noArgs.parse(raw ?? {});
      const res = await listGoals(ctx.userId);
      return {
        goals: res.data.map((g) => ({
          name: clip(g.name, 60),
          saved: showLkr(g.saved, ctx),
          target: showLkr(g.targetAmount, ctx),
          percentSaved: g.percentSaved,
          achieved: g.achieved,
          ...(g.targetDate ? { targetDate: isoDateInZone(new Date(g.targetDate), env.APP_TIMEZONE) } : {}),
          ...(g.monthlyNeeded ? { saveEachMonth: showLkr(g.monthlyNeeded, ctx) } : {}),
        })),
      };
    },
  },
};

export const toolDeclarations: FunctionDeclaration[] = Object.values(tools).map((t) => t.declaration);

/** Runs a tool the model asked for. Never throws: a problem is returned to the model as { error }, so it can explain or retry. */
export async function runTool(ctx: ToolContext, name: string, args: unknown): Promise<unknown> {
  const tool = tools[name];
  if (!tool) return { error: `Unknown tool ${clip(name, 40)}` };
  try {
    return await tool.run(ctx, args ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) return { error: `Invalid arguments: ${err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
    return { error: err instanceof Error ? clip(err.message, 300) : "The data could not be read" };
  }
}
