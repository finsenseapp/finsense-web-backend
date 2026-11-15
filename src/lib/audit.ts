import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";

export type AuditAction =
  | "USER_REGISTERED"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGIN_BLOCKED_SUSPENDED"
  | "PASSWORD_CHANGED"
  | "EMAIL_CHANGED"
  | "ACCOUNT_DELETED_BY_USER"
  | "ADMIN_USER_SUSPENDED"
  | "ADMIN_USER_REACTIVATED"
  | "ADMIN_USER_REMOVED";

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  /** Masked email of whoever did it. */
  actorLabel?: string | null;
  targetId?: string | null;
  /** Masked email of whoever it was done to. */
  targetLabel?: string | null;
  ip?: string | null;
  /** Small, non-sensitive details (a reason, a role). Never money, descriptions or other personal data. */
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes one audit entry. Failing to write the log must never break the action being logged, so errors are only
 * reported to the console.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        actorLabel: entry.actorLabel ?? null,
        targetId: entry.targetId ?? null,
        targetLabel: entry.targetLabel ?? null,
        ip: entry.ip ?? null,
        ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
      },
    });
  } catch (err) {
    console.error("Could not write the audit log:", err instanceof Error ? err.message : err);
  }
}
