import { z } from "zod";

export const categorizeSchema = z.object({
  description: z.string().trim().min(3, "Description must be at least 3 characters").max(255),
  // Optional: restricts the choice to INCOME or EXPENSE categories.
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
});

export type CategorizeInput = z.infer<typeof categorizeSchema>;

/** One new message. The conversation itself is kept on the server, so a refresh or a new device keeps it. */
export const chatSchema = z.object({ message: z.string().trim().min(1, "Message is empty").max(1000, "Message is too long") }).strict();

export type ChatInput = z.infer<typeof chatSchema>;
