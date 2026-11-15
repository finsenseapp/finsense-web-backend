import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { categorize, parseStatement, streamChat } from "../../services/aiService.js";
import { getRates } from "../../services/ratesService.js";
import { AppError } from "../../utils/errors.js";
import { buildChatInstruction } from "./chatPrompt.js";
import { runTool, toolDeclarations } from "./chatTools.js";
import { categoryVisibleTo } from "../categories/visibility.js";
import type { CategorizeInput, ChatInput } from "./ai.schemas.js";

/** System categories first, then the user's own, so duplicate names resolve to the system one. */
function loadCategories(userId: string, type?: "INCOME" | "EXPENSE") {
  return prisma.category.findMany({
    where: { ...categoryVisibleTo(userId), ...(type ? { type } : {}) },
    select: { id: true, name: true, type: true },
    orderBy: [{ userId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  });
}

export async function categorizeDescription(userId: string, input: CategorizeInput) {
  const categories = await loadCategories(userId, input.type);
  return categorize({ description: input.description, categories });
}

/** How many earlier messages the model sees, and how many are kept per user. */
const CONTEXT_MESSAGES = 20;
const KEEP_MESSAGES = 200;

/**
 * Streams the chatbot reply. Live rates are put into the prompt (cached 6 h); the user's own data is reached through
 * read-only tools bound to this user (see chatTools.ts). The earlier conversation comes from the database.
 */
export async function chatReply(userId: string, input: ChatInput, signal: AbortSignal) {
  const [user, rates, recent] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, currency: true } }),
    getRates().catch(() => null),
    prisma.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: CONTEXT_MESSAGES }),
  ]);
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Please sign in again.");

  const turns = [
    ...recent.reverse().map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content })),
    { role: "user" as const, content: input.message },
  ];
  while (turns[0]?.role === "assistant") turns.shift(); // a conversation must start with the user

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: env.APP_TIMEZONE, dateStyle: "full" }).format(new Date());
  const toolContext = { userId, currency: user.currency, rates: rates?.rates ?? null };
  return streamChat({
    systemInstruction: buildChatInstruction({ today, userName: user.name, currency: user.currency, rates }),
    turns,
    tools: { declarations: toolDeclarations, run: (name, args) => runTool(toolContext, name, args) },
    signal,
  });
}

/** Saves one finished exchange and trims the history to the newest KEEP_MESSAGES. */
export async function saveChatExchange(userId: string, userText: string, assistantText: string): Promise<void> {
  const now = Date.now();
  await prisma.chatMessage.createMany({
    data: [
      { userId, role: "USER", content: userText, createdAt: new Date(now) },
      { userId, role: "ASSISTANT", content: assistantText.slice(0, 4000), createdAt: new Date(now + 1) },
    ],
  });
  const cutoff = await prisma.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: KEEP_MESSAGES, take: 1, select: { createdAt: true } });
  if (cutoff[0]) await prisma.chatMessage.deleteMany({ where: { userId, createdAt: { lte: cutoff[0].createdAt } } });
}

export async function chatHistory(userId: string) {
  const rows = await prisma.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 60 });
  return { data: rows.reverse().map((m) => ({ id: m.id, role: m.role === "USER" ? "user" : "assistant", content: m.content, createdAt: m.createdAt })) };
}

export async function clearChatHistory(userId: string): Promise<void> {
  await prisma.chatMessage.deleteMany({ where: { userId } });
}

/** Parses an uploaded statement/receipt. Nothing is saved: the client reviews, then calls /transactions/bulk. */
export async function parseUploadedStatement(
  userId: string,
  file: { buffer: Buffer; mimetype: string },
) {
  const categories = await loadCategories(userId);
  return parseStatement({ file, categories });
}
