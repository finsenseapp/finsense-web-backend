import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { aiRateLimit } from "../../middleware/rateLimit.js";
import { uploadStatementFile } from "../../middleware/upload.js";
import { validate } from "../../middleware/validate.js";
import { categorizeSchema, chatSchema } from "./ai.schemas.js";
import { categorizeDescription, chatHistory, chatReply, clearChatHistory, parseUploadedStatement, saveChatExchange } from "./ai.service.js";

export const aiRouter = Router();

aiRouter.use(requireAuth, aiRateLimit);

aiRouter.post("/categorize", validate({ body: categorizeSchema }), async (req, res) => {
  res.json(await categorizeDescription(req.user!.id, req.body));
});

// Chatbot: plain-text stream. Errors before the first word are normal JSON errors (502 etc.).
aiRouter.post("/chat", validate({ body: chatSchema }), async (req, res) => {
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  const stream = await chatReply(req.user!.id, req.body, abort.signal);
  const first = await stream.next(); // a failure here still becomes a proper JSON error
  if (abort.signal.aborted) return;

  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let answer = "";
  try {
    if (!first.done) {
      answer += first.value;
      res.write(first.value);
    }
    for await (const text of stream) {
      answer += text;
      res.write(text);
    }
    // Only a finished answer is remembered, together with the question it answers.
    if (answer.trim() && !abort.signal.aborted) await saveChatExchange(req.user!.id, req.body.message, answer.trim());
  } catch {
    res.write("\n\n(The answer was cut off. Please ask again.)");
  }
  res.end();
});

// The saved conversation: shown again after a refresh, cleared with the trash button.
aiRouter.get("/chat/history", async (req, res) => {
  res.json(await chatHistory(req.user!.id));
});
aiRouter.delete("/chat/history", async (req, res) => {
  await clearChatHistory(req.user!.id);
  res.status(204).end();
});

// Multipart upload, field name "file". Returns the parsed rows for review; saves nothing.
aiRouter.post("/parse-statement", uploadStatementFile, async (req, res) => {
  const { buffer, mimetype } = req.file!;
  res.json(await parseUploadedStatement(req.user!.id, { buffer, mimetype }));
});
