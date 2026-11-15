import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { recordError } from "../../lib/errorLog.js";
import { clientErrorRateLimit } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";

export const errorsRouter = Router();

const clientErrorSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    stack: z.string().max(4000).optional(),
    /** The page it happened on. Only its path is kept. */
    url: z.string().max(300).optional(),
  })
  .strict();

/**
 * The browser reports its own errors here (anyone can: errors also happen on the sign-in page). Rate limited, small,
 * cleaned of personal data before it is stored. The signed-in user's id is attached when there is one.
 */
errorsRouter.post("/", clientErrorRateLimit, validate({ body: clientErrorSchema }), async (req, res) => {
  let userId: string | null = null;
  const token = req.cookies?.finsense_token;
  if (typeof token === "string") {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
      if (typeof payload !== "string") userId = payload.sub ?? null;
    } catch {
      // an invalid or expired token just means "anonymous"
    }
  }
  await recordError({
    source: "client",
    message: req.body.message,
    stack: req.body.stack ?? null,
    url: req.body.url ?? null,
    userAgent: req.get("user-agent") ?? null,
    userId,
  });
  res.status(204).end();
});
