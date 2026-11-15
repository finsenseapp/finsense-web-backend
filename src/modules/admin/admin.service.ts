import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { audit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/errors.js";
import { maskEmail } from "../../utils/mask.js";
import { toSkipTake } from "../../utils/pagination.js";
import { purgeUser } from "../auth/purge.js";
import type { AuditQuery, ErrorsQuery, ListUsersQuery, ModerationInput } from "./admin.schemas.js";

/**
 * What the Super Admin may see: who the accounts are (name, masked email), whether they are active, when they signed
 * up and last logged in, and how many records they hold. Never amounts, descriptions, balances or any other
 * personal finance data: the developer runs the system but cannot read customers' money.
 */
const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  suspendedAt: true,
  suspendReason: true,
  _count: { select: { accounts: true, transactions: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function serializeUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: maskEmail(u.email),
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    suspendedAt: u.suspendedAt,
    suspendReason: u.suspendReason,
    accounts: u._count.accounts,
    transactions: u._count.transactions,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getStats() {
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);
  const customers = { role: "USER" as const };

  const [total, active, suspended, new7, new30, activeLast7, accounts, transactions, signupRows] = await Promise.all([
    prisma.user.count({ where: customers }),
    prisma.user.count({ where: { ...customers, status: "ACTIVE" } }),
    prisma.user.count({ where: { ...customers, status: "SUSPENDED" } }),
    prisma.user.count({ where: { ...customers, createdAt: { gte: since7 } } }),
    prisma.user.count({ where: { ...customers, createdAt: { gte: since30 } } }),
    prisma.user.count({ where: { ...customers, lastLoginAt: { gte: since7 } } }),
    prisma.account.count(),
    prisma.transaction.count(),
    prisma.$queryRaw<{ day: string; count: bigint }[]>`
      SELECT to_char((u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${env.APP_TIMEZONE}, 'YYYY-MM-DD') AS day, COUNT(*) AS count
      FROM "User" u
      WHERE u."role" = 'USER'::"UserRole" AND u."createdAt" >= ${since30.toISOString()}::timestamp
      GROUP BY 1 ORDER BY 1`,
  ]);

  return {
    users: { total, active, suspended, newLast7Days: new7, newLast30Days: new30, activeLast7Days: activeLast7 },
    // Totals across all customers, counts only.
    records: { accounts, transactions },
    signups: signupRows.map((r) => ({ date: r.day, count: Number(r.count) })),
  };
}

export async function listUsers(q: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.search
      ? q.search.includes("@")
        ? { email: q.search.toLowerCase() } // an exact address only: no browsing of emails by fragments
        : { name: { contains: q.search, mode: "insensitive" } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: "desc" }, ...toSkipTake(q) }),
    prisma.user.count({ where }),
  ]);
  return { data: rows.map(serializeUser), meta: { page: q.page, pageSize: q.pageSize, total } };
}

export async function getUserDetail(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!user) throw AppError.notFound("User not found");
  const history = await prisma.auditLog.findMany({
    where: { OR: [{ targetId: id }, { actorId: id }] },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return { user: serializeUser(user), history: history.map(serializeAudit) };
}

export async function listAudit(q: AuditQuery) {
  const where: Prisma.AuditLogWhereInput = q.action ? { action: q.action } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...toSkipTake(q) }),
    prisma.auditLog.count({ where }),
  ]);
  return { data: rows.map(serializeAudit), meta: { page: q.page, pageSize: q.pageSize, total } };
}

function serializeAudit(a: Awaited<ReturnType<typeof prisma.auditLog.findFirstOrThrow>>) {
  return {
    id: a.id,
    action: a.action,
    actor: a.actorLabel,
    target: a.targetLabel,
    targetId: a.targetId,
    ip: a.ip,
    metadata: a.metadata,
    createdAt: a.createdAt,
  };
}

/** An admin cannot act on themselves or on another admin, and only regular accounts exist as targets. */
async function findModerationTarget(adminId: string, targetId: string) {
  if (adminId === targetId) throw AppError.badRequest("You cannot do this to your own account");
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, email: true, role: true, status: true } });
  if (!target) throw AppError.notFound("User not found");
  if (target.role === "SUPER_ADMIN") throw AppError.forbidden("Administrator accounts cannot be moderated");
  return target;
}

export interface AdminContext {
  adminId: string;
  adminEmail: string;
  ip?: string | undefined;
}

export async function suspendUser(ctx: AdminContext, targetId: string, input: ModerationInput) {
  const target = await findModerationTarget(ctx.adminId, targetId);
  if (target.status === "SUSPENDED") throw AppError.conflict("This account is already suspended");
  await prisma.user.update({
    where: { id: target.id },
    data: { status: "SUSPENDED", suspendedAt: new Date(), suspendReason: input.reason },
  });
  await audit({
    action: "ADMIN_USER_SUSPENDED",
    actorId: ctx.adminId,
    actorLabel: maskEmail(ctx.adminEmail),
    targetId: target.id,
    targetLabel: maskEmail(target.email),
    ip: ctx.ip,
    metadata: { reason: input.reason, ...(input.note ? { note: input.note } : {}) },
  });
}

export async function reactivateUser(ctx: AdminContext, targetId: string) {
  const target = await findModerationTarget(ctx.adminId, targetId);
  if (target.status === "ACTIVE") throw AppError.conflict("This account is not suspended");
  await prisma.user.update({ where: { id: target.id }, data: { status: "ACTIVE", suspendedAt: null, suspendReason: null } });
  await audit({
    action: "ADMIN_USER_REACTIVATED",
    actorId: ctx.adminId,
    actorLabel: maskEmail(ctx.adminEmail),
    targetId: target.id,
    targetLabel: maskEmail(target.email),
    ip: ctx.ip,
  });
}

/** Permanently removes the user and all their data. The audit entry is written first and keeps only the masked email. */
export async function removeUser(ctx: AdminContext, targetId: string, input: ModerationInput) {
  const target = await findModerationTarget(ctx.adminId, targetId);
  await audit({
    action: "ADMIN_USER_REMOVED",
    actorId: ctx.adminId,
    actorLabel: maskEmail(ctx.adminEmail),
    targetId: target.id,
    targetLabel: maskEmail(target.email),
    ip: ctx.ip,
    metadata: { reason: input.reason, ...(input.note ? { note: input.note } : {}) },
  });
  await purgeUser(target.id);
}

// ------------------------------------------------------------- error log

/** Errors seen by the server and by users' browsers, newest first. Text was cleaned of personal data when it was stored. */
export async function listErrors(q: ErrorsQuery) {
  const where: Prisma.ErrorLogWhereInput = q.status === "open" ? { resolvedAt: null } : q.status === "resolved" ? { resolvedAt: { not: null } } : {};
  const [rows, total, open] = await Promise.all([
    prisma.errorLog.findMany({ where, orderBy: { lastSeenAt: "desc" }, ...toSkipTake(q) }),
    prisma.errorLog.count({ where }),
    prisma.errorLog.count({ where: { resolvedAt: null } }),
  ]);
  return {
    data: rows.map((e) => ({
      id: e.id,
      source: e.source,
      message: e.message,
      stack: e.stack,
      url: e.url,
      userAgent: e.userAgent,
      count: e.count,
      firstSeenAt: e.firstSeenAt,
      lastSeenAt: e.lastSeenAt,
      resolved: e.resolvedAt !== null,
    })),
    meta: { page: q.page, pageSize: q.pageSize, total, open },
  };
}

export async function resolveError(id: string) {
  const existing = await prisma.errorLog.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw AppError.notFound("Error not found");
  await prisma.errorLog.update({ where: { id }, data: { resolvedAt: new Date() } });
}
