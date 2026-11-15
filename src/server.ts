import { env } from "./config/env.js";
import { app } from "./app.js";
import { recordError } from "./lib/errorLog.js";
import { startRecurringScheduler } from "./modules/recurring/recurring.scheduler.js";

app.listen(env.PORT, () => {
  console.log(`FinSense backend listening on http://localhost:${env.PORT}`);
});

startRecurringScheduler();

// Errors nobody caught: write them to the error log, then (for a crash) stop so a supervisor can restart a clean process.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  void recordError({ source: "server", message: reason instanceof Error ? reason.message : "Unhandled promise rejection", stack: reason instanceof Error ? reason.stack : null });
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  void recordError({ source: "server", message: err.message, stack: err.stack }).finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 2000).unref(); // never hang if the database is the problem
});
