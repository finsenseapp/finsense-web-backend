import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/errors.js";
import { formatMoney } from "../../utils/money.js";
import { toSkipTake } from "../../utils/pagination.js";
import { deleteFiles } from "../../lib/storage.js";
import { categoryVisibleTo } from "../categories/visibility.js";
import { isoDateInZone } from "../../utils/dates.js";
import { env } from "../../config/env.js";
import { lkrPerUnit } from "../../services/historicalRates.js";
import { receiptKeysOf } from "./attachments.service.js";
import { computeAmounts, resolveAmounts, warmRates, type Amounts } from "./amounts.js";
import {
  computeBalanceEffects,
  computeDeleteEffects,
  computeUpdateEffects,
  mergeEffects,
  type BalanceEffect,
} from "./balance.js";
import {
  shapeIssues,
  type BulkTransactionsInput,
  type CreateTransactionInput,
  type ListTransactionsQuery,
  type UpdateTransactionInput,
} from "./transactions.schemas.js";

type Db = Prisma.TransactionClient;

const include = {
  account: { select: { id: true, name: true, currency: true } },
  toAccount: { select: { id: true, name: true, currency: true } },
  category: { select: { id: true, name: true, icon: true, type: true } },
  _count: { select: { attachments: true } },
} satisfies Prisma.TransactionInclude;

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof include }>;

export function serializeTransaction(t: TransactionWithRelations) {
  return {
    id: t.id,
    type: t.type,
    /** The value in LKR (what dashboards add up). */
    amount: formatMoney(t.amount),
    /** The exact amount in the account's own currency, for a foreign-currency account. */
    accountAmount: t.accountAmount ? formatMoney(t.accountAmount) : null,
    accountCurrency: t.account.currency,
    /** What a transfer's destination received, when it holds another currency than LKR. */
    toAmount: t.toAmount ? formatMoney(t.toAmount) : null,
    toCurrency: t.toAccount?.currency ?? null,
    /** LKR per 1 unit of the account's currency on the transaction's date. */
    rate: t.rate ? t.rate.toString() : null,
    description: t.description,
    rawDescription: t.rawDescription,
    merchantName: t.merchantName,
    aiConfidence: t.aiConfidence,
    source: t.source,
    splitGroupId: t.splitGroupId,
    attachmentCount: t._count.attachments,
    date: t.date,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    categoryId: t.categoryId,
    account: t.account,
    toAccount: t.toAccount,
    category: t.category,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export const transactionInclude = include;

// ---------------------------------------------------------------- helpers

/** Apply balance deltas atomically in the DB. Sorted by id so concurrent writers lock in one order. */
export async function applyEffects(db: Db, effects: BalanceEffect[]) {
  const sorted = [...effects].sort((a, b) => a.accountId.localeCompare(b.accountId));
  for (const { accountId, delta } of sorted) {
    await db.account.update({
      where: { id: accountId },
      data: { balance: { increment: delta } },
    });
  }
}

function validationError(issues: { path: string; message: string }[]) {
  return new AppError(
    400,
    "VALIDATION_ERROR",
    "Invalid request",
    issues.map((i) => ({ in: "body", path: i.path, message: i.message })),
  );
}

/** Referenced accounts must be the user's; the category must be visible to the user and match the type. */
export async function assertReferences(
  db: Db,
  userId: string,
  refs: { type: string; accountId: string; toAccountId?: string | null; categoryId?: string | null },
) {
  const accountIds = [...new Set([refs.accountId, refs.toAccountId].filter((x): x is string => !!x))];
  const owned = await db.account.count({ where: { userId, id: { in: accountIds } } });
  if (owned !== accountIds.length) throw AppError.notFound("Account not found");

  if (refs.categoryId) {
    const category = await db.category.findFirst({
      where: { id: refs.categoryId, ...categoryVisibleTo(userId) },
    });
    if (!category) throw AppError.notFound("Category not found");
    if (category.type !== refs.type) {
      throw new AppError(
        400,
        "CATEGORY_TYPE_MISMATCH",
        `A ${refs.type} transaction needs an ${refs.type} category`,
      );
    }
  }
}

/** Lock the transaction row so concurrent edits/deletes of the same row cannot double-apply effects. */
async function lockOwnedTransaction(db: Db, userId: string, id: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Transaction" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
  if (rows.length === 0) throw AppError.notFound("Transaction not found");
  const existing = await db.transaction.findFirst({ where: { id, userId } });
  if (!existing) throw AppError.notFound("Transaction not found");
  return existing;
}

// ---------------------------------------------------------------- queries

/** The filters shared by the list and the export, so what you see is exactly what you download. */
export function buildTransactionWhere(
  userId: string,
  q: Pick<ListTransactionsQuery, "from" | "to" | "accountId" | "categoryId" | "type" | "search">,
): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [];
  if (q.accountId) and.push({ OR: [{ accountId: q.accountId }, { toAccountId: q.accountId }] });
  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" as const };
    and.push({
      OR: [{ description: contains }, { merchantName: contains }, { rawDescription: contains }],
    });
  }

  return {
    userId,
    ...(q.type ? { type: q.type } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

export async function listTransactions(userId: string, q: ListTransactionsQuery) {
  const where = buildTransactionWhere(userId, q);

  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      ...toSkipTake(q),
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    data: rows.map(serializeTransaction),
    meta: { page: q.page, pageSize: q.pageSize, total },
  };
}

export async function getTransaction(userId: string, id: string) {
  const row = await prisma.transaction.findFirst({ where: { id, userId }, include });
  if (!row) throw AppError.notFound("Transaction not found");
  return serializeTransaction(row);
}

// ---------------------------------------------------------------- mutations

export async function createTransaction(userId: string, input: CreateTransactionInput) {
  // The amount is typed in the account's currency. Rates are fetched before the database transaction opens.
  await warmRates(prisma, userId, [input.accountId, input.toAccountId], [input.date]);
  return prisma.$transaction(async (tx) => {
    await assertReferences(tx, userId, input);
    const money = await resolveAmounts(tx, userId, { accountId: input.accountId, toAccountId: input.toAccountId, native: input.amount, date: input.date });

    const row = await tx.transaction.create({
      data: {
        userId,
        accountId: input.accountId,
        toAccountId: input.toAccountId ?? null,
        categoryId: input.categoryId ?? null,
        amount: money.amount,
        accountAmount: money.accountAmount,
        toAmount: money.toAmount,
        rate: money.rate,
        type: input.type,
        description: input.description,
        rawDescription: input.rawDescription ?? null,
        merchantName: input.merchantName ?? null,
        aiConfidence: input.aiConfidence ?? null,
        source: "MANUAL",
        date: input.date,
      },
      include,
    });

    await applyEffects(tx, computeBalanceEffects(row));
    return serializeTransaction(row);
  });
}

export async function updateTransaction(userId: string, id: string, input: UpdateTransactionInput) {
  const before = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!before) throw AppError.notFound("Transaction not found");
  await warmRates(
    prisma,
    userId,
    [input.accountId ?? before.accountId, input.toAccountId !== undefined ? input.toAccountId : before.toAccountId],
    [input.date ?? before.date],
  );
  return prisma.$transaction(async (tx) => {
    const existing = await lockOwnedTransaction(tx, userId, id);

    const type = input.type ?? existing.type;
    const typeChanged = input.type !== undefined && input.type !== existing.type;
    let toAccountId = input.toAccountId !== undefined ? input.toAccountId : existing.toAccountId;
    let categoryId = input.categoryId !== undefined ? input.categoryId : existing.categoryId;
    // Switching type: clear the field that no longer applies unless the client set it explicitly.
    if (typeChanged && type === "TRANSFER" && input.categoryId === undefined) categoryId = null;
    if (typeChanged && type !== "TRANSFER" && input.toAccountId === undefined) toAccountId = null;

    const merged = {
      type,
      accountId: input.accountId ?? existing.accountId,
      toAccountId,
      categoryId,
    };

    const issues = shapeIssues(merged);
    if (issues.length > 0) throw validationError(issues);
    await assertReferences(tx, userId, merged);

    // The amount is in the account's currency: the exact stored foreign amount when there is one, else the LKR amount.
    const native = input.amount ?? existing.accountAmount ?? existing.amount;
    const money = await resolveAmounts(tx, userId, {
      accountId: merged.accountId,
      toAccountId: merged.toAccountId,
      native,
      date: input.date ?? existing.date,
    });
    const effects = computeUpdateEffects(existing, { ...merged, amount: money.amount, accountAmount: money.accountAmount, toAmount: money.toAmount });

    const row = await tx.transaction.update({
      where: { id },
      data: {
        type: merged.type,
        accountId: merged.accountId,
        toAccountId: merged.toAccountId,
        categoryId: merged.categoryId,
        amount: money.amount,
        accountAmount: money.accountAmount,
        toAmount: money.toAmount,
        rate: money.rate,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rawDescription !== undefined ? { rawDescription: input.rawDescription } : {}),
        ...(input.merchantName !== undefined ? { merchantName: input.merchantName } : {}),
        ...(input.aiConfidence !== undefined ? { aiConfidence: input.aiConfidence } : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
      },
      include,
    });

    await applyEffects(tx, effects);
    return serializeTransaction(row);
  });
}

export async function deleteTransaction(userId: string, id: string) {
  const keys = await receiptKeysOf(userId, [id]); // the rows go with the transaction; the files are removed afterwards
  await prisma.$transaction(async (tx) => {
    const existing = await lockOwnedTransaction(tx, userId, id);
    await tx.transaction.delete({ where: { id } });
    await applyEffects(tx, computeDeleteEffects(existing));
  });
  await deleteFiles(userId, keys);
}

/** All rows inserted and the summed balance effect applied in one DB transaction: all succeed or none. */
export async function bulkCreateTransactions(userId: string, input: BulkTransactionsInput) {
  // Imported amounts are in the account's currency; fetch each day's rate before the database transaction opens.
  await warmRates(prisma, userId, [input.accountId], input.transactions.map((t) => t.date));
  return prisma.$transaction(
    async (tx) => {
      await assertReferences(tx, userId, { type: "", accountId: input.accountId });
      const { currency } = await tx.account.findUniqueOrThrow({ where: { id: input.accountId }, select: { currency: true } });
      const money: Amounts[] = [];
      for (const row of input.transactions) {
        const rateFrom = currency === "LKR" ? null : await lkrPerUnit(currency, isoDateInZone(row.date, env.APP_TIMEZONE));
        money.push(computeAmounts({ native: row.amount, accountCurrency: currency, rateFrom }));
      }

      const categoryIds = [...new Set(input.transactions.map((t) => t.categoryId))];
      const categories = await tx.category.findMany({
        where: { id: { in: categoryIds }, ...categoryVisibleTo(userId) },
        select: { id: true, type: true },
      });
      const typeById = new Map(categories.map((c) => [c.id, c.type]));

      input.transactions.forEach((row, index) => {
        const categoryType = typeById.get(row.categoryId);
        if (!categoryType) {
          throw new AppError(404, "NOT_FOUND", `Category not found (row ${index + 1})`);
        }
        if (categoryType !== row.type) {
          throw new AppError(
            400,
            "CATEGORY_TYPE_MISMATCH",
            `Row ${index + 1}: a ${row.type} transaction needs an ${row.type} category`,
          );
        }
      });

      const { count } = await tx.transaction.createMany({
        data: input.transactions.map((row, i) => ({
          userId,
          accountId: input.accountId,
          toAccountId: null,
          categoryId: row.categoryId,
          amount: money[i]!.amount,
          accountAmount: money[i]!.accountAmount,
          rate: money[i]!.rate,
          type: row.type,
          description: row.description,
          rawDescription: row.rawDescription ?? null,
          merchantName: row.merchantName ?? null,
          aiConfidence: row.aiConfidence ?? null,
          source: "AI_IMPORT" as const,
          date: row.date,
        })),
      });

      const effects = mergeEffects(
        ...input.transactions.map((row, i) =>
          computeBalanceEffects({ type: row.type, accountId: input.accountId, amount: money[i]!.amount, accountAmount: money[i]!.accountAmount }),
        ),
      );
      await applyEffects(tx, effects);

      const account = await tx.account.findUniqueOrThrow({
        where: { id: input.accountId },
        select: { id: true, name: true, balance: true },
      });
      return {
        count,
        account: { id: account.id, name: account.name, balance: formatMoney(account.balance) },
      };
    },
    { timeout: 30_000 },
  );
}
