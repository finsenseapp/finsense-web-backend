import type { Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { monthRange, yearMonthInZone } from "../../utils/dates.js";
import { AppError } from "../../utils/errors.js";
import { Decimal, formatMoney } from "../../utils/money.js";
import { toSkipTake } from "../../utils/pagination.js";
import { categoryVisibleTo } from "../categories/visibility.js";
import { budgetProgress } from "./budget-math.js";
import type { CreateBudgetInput, ListBudgetsQuery, UpdateBudgetInput } from "./budgets.schemas.js";

const include = { category: { select: { id: true, name: true, icon: true } } } satisfies Prisma.BudgetInclude;
type BudgetRow = Prisma.BudgetGetPayload<{ include: typeof include }>;

function serialize(b: BudgetRow, spent: Decimal) {
  const { remaining, percentUsed, status } = budgetProgress(b.amountLimit, spent);
  return {
    id: b.id,
    categoryId: b.categoryId,
    category: b.category,
    month: b.month,
    year: b.year,
    amountLimit: formatMoney(b.amountLimit),
    spent: formatMoney(spent),
    remaining: formatMoney(remaining), // negative when over budget
    percentUsed,
    status,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** Expense totals per category for one month in APP_TIMEZONE, aggregated in the database. Transfers and income never count. */
async function spentByCategory(userId: string, categoryIds: string[], month: number, year: number) {
  const result = new Map<string, Decimal>();
  if (categoryIds.length === 0) return result;
  const { from, to } = monthRange(year, month, env.APP_TIMEZONE);
  const groups = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: { userId, type: "EXPENSE", categoryId: { in: categoryIds }, date: { gte: from, lt: to } },
    _sum: { amount: true },
  });
  for (const g of groups) {
    if (g.categoryId) result.set(g.categoryId, g._sum.amount ?? new Decimal(0));
  }
  return result;
}

const duplicateBudget = () => AppError.conflict("You already have a budget for this category in this month");

export async function listBudgets(userId: string, q: ListBudgetsQuery) {
  const now = yearMonthInZone(new Date(), env.APP_TIMEZONE);
  const month = q.month ?? now.month;
  const year = q.year ?? now.year;
  const where = { userId, month, year };

  const [rows, total] = await Promise.all([
    prisma.budget.findMany({ where, include, orderBy: [{ category: { name: "asc" } }], ...toSkipTake(q) }),
    prisma.budget.count({ where }),
  ]);
  const spent = await spentByCategory(userId, rows.map((r) => r.categoryId), month, year);

  return {
    data: rows.map((r) => serialize(r, spent.get(r.categoryId) ?? new Decimal(0))),
    meta: { page: q.page, pageSize: q.pageSize, total, month, year },
  };
}

export async function createBudget(userId: string, input: CreateBudgetInput) {
  const category = await prisma.category.findFirst({ where: { id: input.categoryId, ...categoryVisibleTo(userId) } });
  if (!category) throw AppError.notFound("Category not found");
  if (category.type !== "EXPENSE") {
    throw new AppError(400, "CATEGORY_TYPE_MISMATCH", "Budgets can only be set for expense categories");
  }

  const existing = await prisma.budget.findFirst({
    where: { userId, categoryId: input.categoryId, month: input.month, year: input.year },
  });
  if (existing) throw duplicateBudget();

  try {
    const row = await prisma.budget.create({
      data: { userId, categoryId: input.categoryId, amountLimit: input.amountLimit, month: input.month, year: input.year },
      include,
    });
    const spent = await spentByCategory(userId, [row.categoryId], row.month, row.year);
    return serialize(row, spent.get(row.categoryId) ?? new Decimal(0));
  } catch (err) {
    // Two simultaneous requests: the unique index decides.
    if ((err as { code?: string })?.code === "P2002") throw duplicateBudget();
    throw err;
  }
}

async function findOwned(userId: string, id: string) {
  const row = await prisma.budget.findFirst({ where: { id, userId } });
  if (!row) throw AppError.notFound("Budget not found");
  return row;
}

export async function updateBudget(userId: string, id: string, input: UpdateBudgetInput) {
  await findOwned(userId, id);
  const row = await prisma.budget.update({ where: { id }, data: { amountLimit: input.amountLimit }, include });
  const spent = await spentByCategory(userId, [row.categoryId], row.month, row.year);
  return serialize(row, spent.get(row.categoryId) ?? new Decimal(0));
}

export async function deleteBudget(userId: string, id: string) {
  await findOwned(userId, id);
  await prisma.budget.delete({ where: { id } });
}
