import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  APP_TIMEZONE: z.string().default("Asia/Colombo"),
  /** Folder for uploaded receipts (relative paths are resolved from where the server starts). Never web-accessible. */
  UPLOAD_DIR: z.string().default("uploads"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Required since Phase 6. Empty values count as missing.
  GEMINI_API_KEY: z.preprocess(
    emptyToUndefined,
    z.string({ error: "GEMINI_API_KEY is required (create a key in Google AI Studio)" }).min(1),
  ),
  GEMINI_MODEL: z.preprocess(
    emptyToUndefined,
    z.string({ error: "GEMINI_MODEL is required (the Gemini Flash model id, e.g. from the AI Studio model picker)" }).min(1),
  ),
  // Optional: a faster, lighter model for the chatbot (e.g. a Flash-Lite model). Falls back to GEMINI_MODEL.
  GEMINI_CHAT_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  // Optional: a second model used when the main one is out of quota, overloaded or retired. A different model has its own quota.
  GEMINI_FALLBACK_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("❌ Invalid environment configuration in backend/.env:");
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;
