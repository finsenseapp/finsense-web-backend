import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "../utils/errors.js";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates req.body / req.query / req.params with zod.
 * Parsed values replace the originals (body, params) or are stored on
 * res.locals.query (Express 5 makes req.query a read-only getter).
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, res, next) => {
    const issues: { in: string; path: string; message: string }[] = [];

    for (const part of ["body", "query", "params"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const parsed = schema.safeParse(req[part]);
      if (!parsed.success) {
        for (const i of parsed.error.issues) {
          issues.push({ in: part, path: i.path.join("."), message: i.message });
        }
        continue;
      }
      if (part === "query") {
        res.locals.query = parsed.data;
      } else {
        (req as unknown as Record<string, unknown>)[part] = parsed.data;
      }
    }

    if (issues.length > 0) {
      next(new AppError(400, "VALIDATION_ERROR", "Invalid request", issues));
      return;
    }
    next();
  };
