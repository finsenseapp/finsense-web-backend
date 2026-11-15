import { modelId, pingModel } from "../services/aiService.js";

console.log(`Model: ${modelId}`);
try {
  const reply = await pingModel();
  console.log(`Response: ${reply.trim()}`);
} catch (err) {
  const e = err as { code?: string; message?: string };
  console.error(`Ping failed: [${e.code ?? "ERROR"}] ${e.message ?? err}`);
  process.exitCode = 1;
}
