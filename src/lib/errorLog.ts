import { fingerprintOf, pathOnly, scrubText } from "../utils/errorFingerprint.js";
import { prisma } from "./prisma.js";

export interface ErrorReport {
  source: "server" | "client";
  message: string;
  stack?: string | null;
  url?: string | null;
  userAgent?: string | null;
  userId?: string | null;
}

/**
 * Stores an error for the Super Admin's "Errors" tab: one row per kind of error, with a count and the last time it
 * happened. Text is cleaned of emails, ids and long numbers first. Recording must never cause a second error, so any
 * failure here is swallowed. An error that was marked resolved and happens again is re-opened.
 */
export async function recordError(report: ErrorReport): Promise<void> {
  try {
    const message = scrubText(report.message).slice(0, 500) || "Unknown error";
    const stack = report.stack ? scrubText(report.stack).slice(0, 4000) : null;
    const url = pathOnly(report.url);
    const fingerprint = fingerprintOf({ source: report.source, message, stack, url });
    const userAgent = report.userAgent ? report.userAgent.slice(0, 200) : null;
    await prisma.errorLog.upsert({
      where: { fingerprint },
      create: { source: report.source, fingerprint, message, stack, url, userAgent, userId: report.userId ?? null },
      update: { count: { increment: 1 }, lastSeenAt: new Date(), resolvedAt: null, userId: report.userId ?? null, ...(stack ? { stack } : {}) },
    });
  } catch (err) {
    console.error("Could not record an error:", err instanceof Error ? err.message : err);
  }
}
