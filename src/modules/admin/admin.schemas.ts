import { z } from "zod";
import { paginationSchema } from "../../utils/pagination.js";

export const REASONS = ["SPAM", "HARM", "SPYING", "OTHER"] as const;

export const listUsersQuerySchema = paginationSchema(20, 100).extend({
  /** An exact email address (contains "@") or part of a name. */
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export const auditQuerySchema = paginationSchema(25, 100).extend({
  action: z.string().trim().min(1).max(60).optional(),
});

export const userIdParamsSchema = z.object({ id: z.uuid() });

/** Why an account is suspended or removed. Always required and always written to the audit log. */
export const moderationBodySchema = z
  .object({
    reason: z.enum(REASONS),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => v.reason !== "OTHER" || (v.note && v.note.length >= 5), {
    path: ["note"],
    message: "Describe the reason in a few words",
  });

export type ModerationInput = z.infer<typeof moderationBodySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const errorsQuerySchema = paginationSchema(20, 100).extend({
  status: z.enum(["open", "resolved", "all"]).default("open"),
});
export type ErrorsQuery = z.infer<typeof errorsQuerySchema>;
