import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { zonedTimeToUtc } from "../../utils/dates.js";
import { Decimal, formatMoney } from "../../utils/money.js";
import { listAccounts, totalBalanceLkr } from "../accounts/accounts.service.js";
import { lastMonthKeys, netWorthSeries, savingsRate } from "./report-math.js";

export const overviewQuerySchema = z.object({ months: z.coerce.number().int().min(3).max(24).default(12) });
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

const TOP_CATEGORIES = 6;

/**
 * One payload for the Reports page: month by month income, expenses and savings rate; net worth at each month end;
 * the biggest expense categories with their monthly series; and the accounts that make up today's net worth.
 * All money is in LKR (the stored currency); the page converts it for display.
 */
export async function getOverview(userId: string, q: OverviewQuery) {
  const tz = env.APP_TIMEZONE;
  const keys = lastMonthKeys(new Date(), q.months, tz);
  const [firstYear, firstMonth] = keys[0]!.split("-").map(Number) as [number, number];
  const from = zonedTimeToUtc(firstYear, firstMonth, 1, tz);
  const fromIso = from.toISOString();

  const [flows, categoryRows, accounts, total] = await Promise.all([
    prisma.$queryRaw<{ month: string; type: "INCOME" | "EXPENSE"; total: Decimal }[]>`
      SELECT to_char((t."date" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month, t."type"::text AS type, SUM(t."amount") AS total
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND t."type" IN ('INCOME'::"TransactionType", 'EXPENSE'::"TransactionType") AND t."date" >= ${fromIso}::timestamp
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ month: string; categoryId: string; total: Decimal }[]>`
      SELECT to_char((t."date" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month, t."categoryId" AS "categoryId", SUM(t."amount") AS total
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND t."type" = 'EXPENSE'::"TransactionType" AND t."categoryId" IS NOT NULL AND t."date" >= ${fromIso}::timestamp
      GROUP BY 1, 2`,
    listAccounts(userId, { page: 1, pageSize: 100 }),
    totalBalanceLkr(userId),
  ]);

  const incomeBy = new Map<string, Decimal>();
  const expenseBy = new Map<string, Decimal>();
  for (const f of flows) (f.type === "INCOME" ? incomeBy : expenseBy).set(f.month, new Decimal(f.total));
  const flowBy = new Map<string, Decimal>(keys.map((k) => [k, (incomeBy.get(k) ?? new Decimal(0)).minus(expenseBy.get(k) ?? new Decimal(0))]));
  const worth = netWorthSeries(total, keys, flowBy);

  const months = keys.map((month, i) => {
    const income = incomeBy.get(month) ?? new Decimal(0);
    const expenses = expenseBy.get(month) ?? new Decimal(0);
    return {
      month,
      income: formatMoney(income),
      expenses: formatMoney(expenses),
      net: formatMoney(income.minus(expenses)),
      savingsRate: savingsRate(income, expenses),
      netWorth: formatMoney(worth[i]!),
    };
  });

  // Top expense categories over the whole window, each with its month-by-month series.
  const perCategory = new Map<string, Map<string, Decimal>>();
  for (const r of categoryRows) {
    const m = perCategory.get(r.categoryId) ?? new Map<string, Decimal>();
    m.set(r.month, new Decimal(r.total));
    perCategory.set(r.categoryId, m);
  }
  const sumOf = (m: Map<string, Decimal>) => [...m.values()].reduce((a, b) => a.plus(b), new Decimal(0));
  const ranked = [...perCategory.entries()].map(([id, m]) => ({ id, m, total: sumOf(m) })).sort((a, b) => b.total.comparedTo(a.total));
  const names = await prisma.category.findMany({ where: { id: { in: ranked.slice(0, TOP_CATEGORIES).map((c) => c.id) } }, select: { id: true, name: true, icon: true } });
  const nameOf = new Map(names.map((c) => [c.id, c]));
  const allExpenses = ranked.reduce((a, c) => a.plus(c.total), new Decimal(0));
  const categories = ranked.slice(0, TOP_CATEGORIES).map((c) => ({
    name: nameOf.get(c.id)?.name ?? "Unknown",
    icon: nameOf.get(c.id)?.icon ?? "circle-ellipsis",
    total: formatMoney(c.total),
    share: allExpenses.isZero() ? 0 : c.total.div(allExpenses).times(100).toDecimalPlaces(1).toNumber(),
    series: keys.map((k) => formatMoney(c.m.get(k) ?? new Decimal(0))),
  }));

  // Averages over the months that have already started (this month counts, partly)
  const totalIncome = [...incomeBy.values()].reduce((a, b) => a.plus(b), new Decimal(0));
  const totalExpenses = [...expenseBy.values()].reduce((a, b) => a.plus(b), new Decimal(0));

  const assets = accounts.data.reduce((a, acc) => (acc.balanceLkr && !acc.balanceLkr.startsWith("-") ? a.plus(acc.balanceLkr) : a), new Decimal(0));
  const liabilities = accounts.data.reduce((a, acc) => (acc.balanceLkr?.startsWith("-") ? a.plus(acc.balanceLkr.slice(1)) : a), new Decimal(0));

  return {
    monthKeys: keys,
    months,
    categories,
    averages: {
      income: formatMoney(totalIncome.div(keys.length)),
      expenses: formatMoney(totalExpenses.div(keys.length)),
      savingsRate: savingsRate(totalIncome, totalExpenses),
    },
    current: {
      netWorth: formatMoney(total),
      assets: formatMoney(assets),
      liabilities: formatMoney(liabilities),
      accounts: accounts.data.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balance: a.balance, balanceLkr: a.balanceLkr })),
    },
    /** What the net worth history does not include. */
    note: "Net worth history is worked back from today's balances using your recorded income and expenses. Exchange-rate changes on foreign-currency accounts are not included.",
  };
}
