import { prisma } from "../../lib/prisma.js";
import { deleteUserFiles } from "../../lib/storage.js";

/**
 * Permanently removes a user and everything they own. Transactions go first because accounts and categories are
 * RESTRICTed; the user delete then cascades the rest. Every feature that stores user data must be added here
 * (used by "delete my account" and by the Super Admin's "remove user").
 */
export async function purgeUser(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId } }),
    prisma.budget.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }), // cascades the user's accounts and categories
  ]);
  await deleteUserFiles(userId); // their receipts
}
