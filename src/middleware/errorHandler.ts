import type { ErrorRequestHandler, RequestHandler } from "express";
import { recordError } from "../lib/errorLog.js";
import { AppError } from "../utils/errors.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    // Server-side failures (a 5xx such as the AI service being down) go to the admin's error log; the user's mistakes (4xx) do not.
    if (err.status >= 500) {
      void recordError({ source: "server", message: `${err.code}: ${err.message}`, stack: err.stack, url: req.originalUrl, userId: req.user?.id ?? null });
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // body-parser errors (invalid JSON, payload too large)
  const status = (err as { status?: number })?.status;
  const type = (err as { type?: string })?.type;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({
      error: {
        code: type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
        message: type === "entity.parse.failed" ? "Invalid JSON body" : "Bad request",
      },
    });
    return;
  }

  console.error("Unhandled error:", err);
  void recordError({
    source: "server",
    message: err instanceof Error ? err.message : "Unhandled error",
    stack: err instanceof Error ? err.stack : null,
    url: req.originalUrl,
    userId: req.user?.id ?? null,
  });
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side" },
  });
};
