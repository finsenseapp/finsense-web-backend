import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../../middleware/auth.js";
import { adminRateLimit } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import {
  auditQuerySchema,
  errorsQuerySchema,
  listUsersQuerySchema,
  moderationBodySchema,
  userIdParamsSchema,
} from "./admin.schemas.js";
import * as service from "./admin.service.js";

export const adminRouter = Router();

// Every admin route: logged in, Super Admin role (checked in the database), and rate limited.
adminRouter.use(requireAuth, requireSuperAdmin, adminRateLimit);

const ctx = (req: Express.Request & { ip?: string }) => ({
  adminId: req.user!.id,
  adminEmail: req.user!.email,
  ip: req.ip,
});

adminRouter.get("/stats", async (_req, res) => {
  res.json(await service.getStats());
});

adminRouter.get("/users", validate({ query: listUsersQuerySchema }), async (_req, res) => {
  res.json(await service.listUsers(res.locals.query));
});

adminRouter.get("/users/:id", validate({ params: userIdParamsSchema }), async (req, res) => {
  res.json(await service.getUserDetail(req.params.id as string));
});

adminRouter.post(
  "/users/:id/suspend",
  validate({ params: userIdParamsSchema, body: moderationBodySchema }),
  async (req, res) => {
    await service.suspendUser(ctx(req), req.params.id as string, req.body);
    res.json({ ok: true });
  },
);

adminRouter.post("/users/:id/reactivate", validate({ params: userIdParamsSchema }), async (req, res) => {
  await service.reactivateUser(ctx(req), req.params.id as string);
  res.json({ ok: true });
});

adminRouter.delete(
  "/users/:id",
  validate({ params: userIdParamsSchema, body: moderationBodySchema }),
  async (req, res) => {
    await service.removeUser(ctx(req), req.params.id as string, req.body);
    res.json({ ok: true });
  },
);

adminRouter.get("/audit-logs", validate({ query: auditQuerySchema }), async (_req, res) => {
  res.json(await service.listAudit(res.locals.query));
});

adminRouter.get("/errors", validate({ query: errorsQuerySchema }), async (_req, res) => {
  res.json(await service.listErrors(res.locals.query));
});

adminRouter.post("/errors/:id/resolve", validate({ params: userIdParamsSchema }), async (req, res) => {
  await service.resolveError(req.params.id as string);
  res.json({ ok: true });
});
