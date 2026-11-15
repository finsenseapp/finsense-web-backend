import { z } from "zod";
import { paginationSchema } from "../../utils/pagination.js";

export const listNotificationsQuerySchema = paginationSchema(20, 50).extend({
  unread: z.enum(["true", "false"]).optional(),
});
export const notificationIdParamsSchema = z.object({ id: z.uuid() });

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
