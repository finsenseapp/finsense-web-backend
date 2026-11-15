import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const tooMany = (message: string) => (_req: Request, res: import("express").Response) => {
  res.status(429).json({ error: { code: "RATE_LIMITED", message } });
};

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

/** AI endpoints: 30 requests per minute per logged-in user. Must run after requireAuth. */
export const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.user?.id ?? "anonymous",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany("Too many AI requests. Please wait a moment and try again."),
});

/**
 * Auth rate limiting, in three layers (GET /me and /logout are harmless and never counted):
 *
 *  1. authIpRateLimit: a broad per-IP ceiling for every auth call (credential stuffing across many emails).
 *  2. loginRateLimit: 20 FAILED logins per 15 minutes for one (IP, email) pair (password guessing).
 *     Keyed by email as well as IP on purpose: behind the Next.js /api proxy the backend sees the
 *     proxy's address for every visitor, so a pure per-IP limit would let one person lock everyone out.
 *  3. registerRateLimit: 20 sign-ups per 15 minutes per IP.
 */
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authMessage = "Too many attempts. Please try again in a few minutes.";

export const authIpRateLimit = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  limit: 200,
  skip: (req) => req.path === "/me" || req.path === "/logout",
  keyGenerator: clientIp,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany(authMessage),
});

export const loginRateLimit = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  limit: 20,
  skipSuccessfulRequests: true, // only failed attempts count
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${clientIp(req)}|${email}`;
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany(authMessage),
});

export const registerRateLimit = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  limit: 20,
  keyGenerator: clientIp,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany(authMessage),
});

/** Password re-checks for a logged-in user (change email / password, delete account): 10 wrong passwords per 15 minutes. */
export const passwordCheckRateLimit = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.user?.id ?? "anonymous",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany(authMessage),
});

/** Admin console: 120 requests per minute per admin. */
export const adminRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => req.user?.id ?? "anonymous",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany("Too many admin requests. Please wait a moment."),
});

/** Exports are heavy: 10 per minute per user. */
export const exportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? "anonymous",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany("Too many exports. Please wait a moment and try again."),
});

/** Browser error reports: 30 per minute per address, so a broken page cannot flood the log. */
export const clientErrorRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: clientIp,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany("Too many reports."),
});
