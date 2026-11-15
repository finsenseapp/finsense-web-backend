import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/errors.js";
import { toSkipTake } from "../../utils/pagination.js";
import { syncBudgetAlerts } from "./budget-alerts.js";
import type { ListNotificationsQuery } from "./notifications.schemas.js";

type Row = Awaited<ReturnType<typeof prisma.notification.findFirstOrThrow>>;

const serialize = (n: Row) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  data: n.data,
  link: n.link,
  read: n.readAt !== null,
  createdAt: n.createdAt,
});

export async function listNotifications(userId: string, q: ListNotificationsQuery) {
  await syncBudgetAlerts(userId, true); // opening the bell always shows the latest
  const where = { userId, ...(q.unread === "true" ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, ...toSkipTake(q) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { data: rows.map(serialize), meta: { page: q.page, pageSize: q.pageSize, total, unread } };
}

export async function unreadCount(userId: string) {
  await syncBudgetAlerts(userId);
  return { count: await prisma.notification.count({ where: { userId, readAt: null } }) };
}

async function findOwned(userId: string, id: string) {
  const row = await prisma.notification.findFirst({ where: { id, userId } });
  if (!row) throw AppError.notFound("Notification not found");
  return row;
}

export async function markRead(userId: string, id: string) {
  await findOwned(userId, id);
  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

export async function removeNotification(userId: string, id: string) {
  await findOwned(userId, id);
  await prisma.notification.delete({ where: { id } });
}
