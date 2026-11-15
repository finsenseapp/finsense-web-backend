import { processDueRules } from "./recurring.service.js";

const EVERY_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 10_000;

let running = false;

async function tick() {
  if (running) return; // a slow run must not overlap the next one
  running = true;
  try {
    const posted = await processDueRules();
    if (posted > 0) console.log(`Recurring transactions posted: ${posted}`);
  } catch (err) {
    console.error("Recurring job failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

/** Starts the background job: once shortly after startup (catches up after downtime), then every 15 minutes. */
export function startRecurringScheduler(): void {
  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void tick(), EVERY_MS).unref();
}
