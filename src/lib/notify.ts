import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";

export interface NewNotification {
  type: "BUDGET_WARNING" | "BUDGET_EXCEEDED" | "GOAL_REACHED" | "RECURRING_POSTED" | "SYSTEM";
  title: string;
  data?: Prisma.InputJsonValue;
  link?: string;
  /** Asking for the same key twice creates one notification. */
  dedupeKey?: string;
}

/** Creates a notification. A repeated dedupeKey is ignored; any failure is only logged (an alert must never break the action). */
export async function notify(userId: string, n: NewNotification): Promise<void> {
  try {
    await prisma.notification.createMany({
      data: [
        {
          userId,
          type: n.type,
          title: n.title,
          ...(n.data !== undefined ? { data: n.data } : {}),
          ...(n.link ? { link: n.link } : {}),
          ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
        },
      ],
      skipDuplicates: true,
    });
  } catch (err) {
    console.error("Could not create a notification:", err instanceof Error ? err.message : err);
  }
}
