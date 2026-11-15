import { randomUUID } from "node:crypto";
import { deleteFiles } from "../../lib/storage.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/errors.js";
import { categoryVisibleTo } from "../categories/visibility.js";
import { receiptKeysOf } from "./attachments.service.js";
import { computeBalanceEffects, computeDeleteEffects, mergeEffects } from "./balance.js";
import { resolveAmounts, warmRates } from "./amounts.js";
import { applyEffects, assertReferences, serializeTransaction, transactionInclude } from "./transactions.service.js";
import type { SplitTransactionInput } from "./transactions.schemas.js";

/**
 * One purchase divided over several categories (for example a supermarket bill: groceries, cleaning, a gift).
 * Each part is saved as an ordinary transaction, and all parts share a splitGroupId. That keeps every report,
 * budget and filter correct without any special case: they just see several transactions. The balance effect of the
 * whole is applied once, in the same database transaction as the inserts: all parts are saved or none.
 */
export async function createSplit(userId: string, input: SplitTransactionInput) {
  await warmRates(prisma, userId, [input.accountId], [input.date]); // parts are in the account's currency
  return prisma.$transaction(async (tx) => {
    await assertReferences(tx, userId, { type: input.type, accountId: input.accountId });

    const categoryIds = [...new Set(input.parts.map((p) => p.categoryId))];
    const categories = await tx.category.findMany({
      where: { id: { in: categoryIds }, ...categoryVisibleTo(userId) },
      select: { id: true, type: true },
    });
    const typeById = new Map(categories.map((c) => [c.id, c.type]));
    input.parts.forEach((part, index) => {
      const type = typeById.get(part.categoryId);
      if (!type) throw new AppError(404, "NOT_FOUND", `Category not found (part ${index + 1})`);
      if (type !== input.type) {
        throw new AppError(400, "CATEGORY_TYPE_MISMATCH", `Part ${index + 1}: a ${input.type} needs an ${input.type} category`);
      }
    });

    const splitGroupId = randomUUID();
    const rows = [];
    for (const part of input.parts) {
      const money = await resolveAmounts(tx, userId, { accountId: input.accountId, native: part.amount, date: input.date });
      rows.push(
        await tx.transaction.create({
          data: {
            userId,
            accountId: input.accountId,
            toAccountId: null,
            categoryId: part.categoryId,
            amount: money.amount,
            accountAmount: money.accountAmount,
            rate: money.rate,
            type: input.type,
            description: part.note ? `${input.description} - ${part.note}` : input.description,
            source: "MANUAL",
            splitGroupId,
            date: input.date,
          },
          include: transactionInclude,
        }),
      );
    }
    await applyEffects(tx, mergeEffects(...rows.map((r) => computeBalanceEffects(r))));
    return { splitGroupId, transactions: rows.map(serializeTransaction) };
  });
}

/** Deletes every part of a split, reverses their balance effects, and removes their receipts. */
export async function deleteSplit(userId: string, splitGroupId: string) {
  const parts = await prisma.transaction.findMany({ where: { userId, splitGroupId } });
  if (parts.length === 0) throw AppError.notFound("Split not found");
  const keys = await receiptKeysOf(userId, parts.map((p) => p.id));

  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction so a part deleted a moment ago is not reversed twice.
    const current = await tx.transaction.findMany({ where: { userId, splitGroupId } });
    await tx.transaction.deleteMany({ where: { userId, splitGroupId } });
    await applyEffects(tx, mergeEffects(...current.map((p) => computeDeleteEffects(p))));
  });
  await deleteFiles(userId, keys);
}
