import { prisma } from "../../lib/prisma.js";
import { deleteFiles, openFile, saveFile } from "../../lib/storage.js";
import { AppError } from "../../utils/errors.js";

export const MAX_ATTACHMENTS_PER_TRANSACTION = 5;
export const MAX_ATTACHMENTS_PER_USER = 300;

type Row = Awaited<ReturnType<typeof prisma.attachment.findFirstOrThrow>>;

const serialize = (a: Row) => ({
  id: a.id,
  filename: a.filename,
  mimeType: a.mimeType,
  size: a.size,
  createdAt: a.createdAt,
});

async function assertOwnsTransaction(userId: string, transactionId: string) {
  const tx = await prisma.transaction.findFirst({ where: { id: transactionId, userId }, select: { id: true } });
  if (!tx) throw AppError.notFound("Transaction not found");
}

/** The name is shown to the user and put in a download header, so keep only a plain, short file name. */
export function cleanFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "receipt";
  const cleaned = base.replace(/[^\p{L}\p{N}._ ()-]/gu, "_").trim().slice(0, 100);
  return cleaned || "receipt";
}

export async function listAttachments(userId: string, transactionId: string) {
  await assertOwnsTransaction(userId, transactionId);
  const rows = await prisma.attachment.findMany({ where: { transactionId, userId }, orderBy: { createdAt: "asc" } });
  return { data: rows.map(serialize) };
}

export async function addAttachment(userId: string, transactionId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
  await assertOwnsTransaction(userId, transactionId);
  const [forTransaction, forUser] = await Promise.all([
    prisma.attachment.count({ where: { transactionId, userId } }),
    prisma.attachment.count({ where: { userId } }),
  ]);
  if (forTransaction >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    throw new AppError(409, "TOO_MANY_ATTACHMENTS", `A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} receipts`);
  }
  if (forUser >= MAX_ATTACHMENTS_PER_USER) {
    throw new AppError(409, "STORAGE_LIMIT", "You have reached the receipt storage limit. Remove some old receipts first.");
  }

  const storageKey = await saveFile(userId, file.buffer);
  try {
    const row = await prisma.attachment.create({
      data: { userId, transactionId, filename: cleanFilename(file.originalname), mimeType: file.mimetype, size: file.size, storageKey },
    });
    return serialize(row);
  } catch (err) {
    await deleteFiles(userId, [storageKey]); // never leave a file without a row
    throw err;
  }
}

/** Ownership checked, then the file is streamed. */
export async function openAttachment(userId: string, transactionId: string, attachmentId: string) {
  const row = await prisma.attachment.findFirst({ where: { id: attachmentId, transactionId, userId } });
  if (!row) throw AppError.notFound("Receipt not found");
  return { row, stream: openFile(userId, row.storageKey) };
}

export async function removeAttachment(userId: string, transactionId: string, attachmentId: string) {
  const row = await prisma.attachment.findFirst({ where: { id: attachmentId, transactionId, userId } });
  if (!row) throw AppError.notFound("Receipt not found");
  await prisma.attachment.delete({ where: { id: row.id } });
  await deleteFiles(userId, [row.storageKey]);
}

/** Storage keys of every receipt on these transactions: collected before the rows are deleted, so the files can follow. */
export async function receiptKeysOf(userId: string, transactionIds: string[]): Promise<string[]> {
  if (transactionIds.length === 0) return [];
  const rows = await prisma.attachment.findMany({ where: { userId, transactionId: { in: transactionIds } }, select: { storageKey: true } });
  return rows.map((r) => r.storageKey);
}
