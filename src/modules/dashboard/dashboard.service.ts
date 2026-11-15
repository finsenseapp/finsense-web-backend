import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { Decimal, formatMoney } from "../../utils/money.js";
import { totalBalanceLkr } from "../accounts/accounts.service.js";
import {
  serializeTransaction,
  transactionInclude,
} from "../transactions/transactions.service.js";
import { percentChange, resolvePeriod } from "./dashboard-math.js";
import type { SummaryQuery } from "./dashboard.schemas.js";

export async function getSummary(userId: string, q: SummaryQuery) {
  const tz = env.APP_TIMEZONE;
  // The period on screen (a week, a month or a year) and the one right before it of the same length.
  const period = resolvePeriod(q, tz);
  const { from, to } = period;

  const inMonth = { userId, date: { gte: from, lt: to } };

  // All aggregation happens in the database (SUM / GROUP BY), not in JS loops over rows.
  const [balance, totalsByType, expenseGroups, recent, prevTotalsByType, dailyRows] = await Promise.all([
    totalBalanceLkr(userId), // foreign-currency accounts are converted at the latest rate
    prisma.transaction.groupBy({
      by: ["type"],
      where: { ...inMonth, type: { in: ["INCOME", "EXPENSE"] } }, // transfers are neither income nor expense
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { ...inMonth, type: "EXPENSE", categoryId: { not: null } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { userId },
      include: transactionInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
    // The previous period, for the "vs last week / month / year" comparison.
    prisma.transaction.groupBy({
      by: ["type"],
      where: { userId, date: { gte: period.prevFrom, lt: period.prevTo }, type: { in: ["INCOME", "EXPENSE"] } },
      _sum: { amount: true },
    }),
    // Income and expenses per calendar day (in APP_TIMEZONE) for the trend chart and the card sparklines.
    // Dates go in as ISO text cast to timestamp: the column stores UTC without a zone, so the session time zone must not interfere.
    prisma.$queryRaw<{ day: string; type: "INCOME" | "EXPENSE"; total: Decimal }[]>`
      SELECT to_char((t."date" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
             t."type"::text AS type,
             SUM(t."amount") AS total
      FROM "Transaction" t
      WHERE t."userId" = ${userId}
        AND t."type" IN ('INCOME'::"TransactionType", 'EXPENSE'::"TransactionType")
        AND t."date" >= ${from.toISOString()}::timestamp
        AND t."date" <  ${to.toISOString()}::timestamp
      GROUP BY 1, 2
      ORDER BY 1`,
  ]);

  const sumFor = (rows: typeof totalsByType, type: "INCOME" | "EXPENSE") =>
    rows.find((g) => g.type === type)?._sum.amount ?? new Decimal(0);
  const income = sumFor(totalsByType, "INCOME");
  const expenses = sumFor(totalsByType, "EXPENSE");
  const prevIncome = sumFor(prevTotalsByType, "INCOME");
  const prevExpenses = sumFor(prevTotalsByType, "EXPENSE");

  const dailyByDate = new Map<string, { income: Decimal; expenses: Decimal }>();
  for (const row of dailyRows) {
    const entry = dailyByDate.get(row.day) ?? { income: new Decimal(0), expenses: new Decimal(0) };
    if (row.type === "INCOME") entry.income = new Decimal(row.total);
    else entry.expenses = new Decimal(row.total);
    dailyByDate.set(row.day, entry);
  }
  const daily = [...dailyByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, income: formatMoney(v.income), expenses: formatMoney(v.expenses) }));

  const categoryIds = expenseGroups.map((g) => g.categoryId!).filter(Boolean);
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, icon: true },
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const expenseByCategory = expenseGroups
    .map((g) => {
      const c = categoryById.get(g.categoryId!);
      return {
        categoryId: g.categoryId!,
        name: c?.name ?? "Unknown",
        icon: c?.icon ?? "circle-ellipsis",
        total: g._sum.amount ?? new Decimal(0),
      };
    })
    .sort((a, b) => b.total.comparedTo(a.total))
    .map((c) => ({ ...c, total: formatMoney(c.total) }));

  return {
    period: { range: period.range, month: period.month, year: period.year, weekStart: period.weekStart, from, to },
    totalBalance: formatMoney(balance),
    monthlyIncome: formatMoney(income),
    monthlyExpenses: formatMoney(expenses),
    netSavings: formatMoney(income.minus(expenses)),
    expenseByCategory,
    recentTransactions: recent.map(serializeTransaction),
    /** Same metrics for the period before (previous week / month / year), and how much each changed (null = nothing to compare against). */
    comparison: {
      previousPeriod: { range: period.range, from: period.prevFrom, to: period.prevTo },
      income: { previous: formatMoney(prevIncome), changePercent: percentChange(income, prevIncome) },
      expenses: { previous: formatMoney(prevExpenses), changePercent: percentChange(expenses, prevExpenses) },
      net: {
        previous: formatMoney(prevIncome.minus(prevExpenses)),
        changePercent: percentChange(income.minus(expenses), prevIncome.minus(prevExpenses)),
      },
    },
    /** One entry per day that has income or expenses, oldest first. Missing days mean zero. For a year the client groups these by month. */
    daily,
  };
}
