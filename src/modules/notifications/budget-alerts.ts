import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { notify } from "../../lib/notify.js";
import { monthRange, yearMonthInZone } from "../../utils/dates.js";
import { Decimal, formatMoney } from "../../utils/money.js";
import { budgetProgress } from "../budgets/budget-math.js";

const lastSync = new Map<string, number>();
const MIN_INTERVAL_MS = 1_000;

/**
 * Makes sure every budget of the current month that is at 80% or over has its notification (one for "80%", one for
 * "over"). Called when notifications are read, so the transaction code stays untouched; the dedupe key makes it
 * safe to call as often as we like, and a short per-user pause keeps the polling bell cheap.
 */
export async function syncBudgetAlerts(userId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastSync.get(userId) ?? 0) < MIN_INTERVAL_MS) return;
  lastSync.set(userId, now);

  const { year, month } = yearMonthInZone(new Date(now), env.APP_TIMEZONE);
  const budgets = await prisma.budget.findMany({
    where: { userId, month, year },
    include: { category: { select: { name: true } } },
  });
  if (budgets.length === 0) return;

  const { from, to } = monthRange(year, month, env.APP_TIMEZONE);
  const groups = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: { userId, type: "EXPENSE", categoryId: { in: budgets.map((b) => b.categoryId) }, date: { gte: from, lt: to } },
    _sum: { amount: true },
  });
  const spentBy = new Map(groups.map((g) => [g.categoryId, g._sum.amount ?? new Decimal(0)]));

  for (const b of budgets) {
    const spent = spentBy.get(b.categoryId) ?? new Decimal(0);
    const { status, percentUsed } = budgetProgress(b.amountLimit, spent);
    if (status === "ok") continue;
    const over = status === "over";
    await notify(userId, {
      type: over ? "BUDGET_EXCEEDED" : "BUDGET_WARNING",
      title: over ? `${b.category.name} budget exceeded` : `${b.category.name} budget at ${Math.floor(percentUsed)}%`,
      data: {
        categoryName: b.category.name,
        spent: formatMoney(spent),
        limit: formatMoney(b.amountLimit),
        percentUsed,
        month,
        year,
      },
      link: "/budgets",
      dedupeKey: `budget:${b.id}:${over ? "over" : "80"}`,
    });
  }
}
