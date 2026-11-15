import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/errors.js";

const COOKIE_NAME = "finsense_token";

/**
 * Checks the login cookie, then the database: the user must still exist and must not be suspended. Looking the user
 * up on every request is what makes "suspend" and "remove" by the Super Admin take effect immediately, instead of
 * after the 7-day token expires. The role always comes from the database, never from the token.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string" || token === "") {
    throw AppError.unauthorized();
  }

  let subject: string;
  try {
    // Pin the algorithm: tokens are signed with HS256 only.
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) throw AppError.unauthorized();
    subject = payload.sub;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.unauthorized("Session expired or invalid. Please log in again.");
  }

  const user = await prisma.user.findUnique({
    where: { id: subject },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!user) throw AppError.unauthorized("Session expired or invalid. Please log in again.");
  if (user.status === "SUSPENDED") {
    throw new AppError(401, "ACCOUNT_SUSPENDED", "This account has been suspended.");
  }

  req.user = { id: user.id, email: user.email, role: user.role };
  next();
};

/** Only the Super Admin passes. Must run after requireAuth. */
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== "SUPER_ADMIN") throw AppError.forbidden("Administrator access required");
  next();
};
