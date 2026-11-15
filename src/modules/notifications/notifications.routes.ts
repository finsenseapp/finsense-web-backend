import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { listNotificationsQuerySchema, notificationIdParamsSchema } from "./notifications.schemas.js";
import * as service from "./notifications.service.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", validate({ query: listNotificationsQuerySchema }), async (req, res) => {
  res.json(await service.listNotifications(req.user!.id, res.locals.query));
});
notificationsRouter.get("/unread-count", async (req, res) => {
  res.json(await service.unreadCount(req.user!.id));
});
notificationsRouter.post("/read-all", async (req, res) => {
  await service.markAllRead(req.user!.id);
  res.json({ ok: true });
});
notificationsRouter.post("/:id/read", validate({ params: notificationIdParamsSchema }), async (req, res) => {
  await service.markRead(req.user!.id, req.params.id as string);
  res.json({ ok: true });
});
notificationsRouter.delete("/:id", validate({ params: notificationIdParamsSchema }), async (req, res) => {
  await service.removeNotification(req.user!.id, req.params.id as string);
  res.status(204).end();
});
