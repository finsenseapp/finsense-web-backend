import { daysInMonth } from "../../utils/dates.js";
import { ymdInZone, zonedTimeToUtc } from "../../utils/dates.js";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  frequency: Frequency;
  /** Every N days / weeks / months / years. */
  interval: number;
  /** The first occurrence. Its day of the month (and month, for yearly) is the anchor, so 31 Jan goes to 28 Feb then 31 Mar. */
  startDate: Date;
}

/**
 * The occurrence after `current` (both are the start of a day in `tz`). Monthly and yearly rules keep their anchor
 * day and clamp to the end of short months, so a rent on the 31st is never pushed to the 3rd.
 */
export function nextOccurrence(rule: RecurrenceRule, current: Date, tz: string): Date {
  const cur = ymdInZone(current, tz);
  switch (rule.frequency) {
    case "DAILY":
      return zonedTimeToUtc(cur.year, cur.month, cur.day + rule.interval, tz);
    case "WEEKLY":
      return zonedTimeToUtc(cur.year, cur.month, cur.day + 7 * rule.interval, tz);
    case "MONTHLY": {
      const anchor = ymdInZone(rule.startDate, tz).day;
      const index = cur.year * 12 + (cur.month - 1) + rule.interval;
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      return zonedTimeToUtc(year, month, Math.min(anchor, daysInMonth(year, month)), tz);
    }
    case "YEARLY": {
      const anchor = ymdInZone(rule.startDate, tz);
      const year = cur.year + rule.interval;
      return zonedTimeToUtc(year, anchor.month, Math.min(anchor.day, daysInMonth(year, anchor.month)), tz);
    }
  }
}

/** The first occurrence that is on or after `from` (used when a paused rule is resumed: missed days are not back-filled). */
export function firstOccurrenceOnOrAfter(rule: RecurrenceRule, from: Date, tz: string): Date {
  let occurrence = rule.startDate;
  // Bounded: a daily rule paused for years still resolves in a few thousand steps.
  for (let i = 0; i < 20_000 && occurrence.getTime() < from.getTime(); i++) {
    occurrence = nextOccurrence(rule, occurrence, tz);
  }
  return occurrence;
}

/** Plain-English summary, for example "Every month on the 1st" or "Every 2 weeks". */
export function describeRecurrence(rule: RecurrenceRule, tz: string): string {
  const n = rule.interval;
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  const start = ymdInZone(rule.startDate, tz);
  switch (rule.frequency) {
    case "DAILY":
      return every("day");
    case "WEEKLY":
      return every("week");
    case "MONTHLY":
      return `${every("month")} on the ${ordinal(start.day)}`;
    case "YEARLY":
      return `${every("year")} on ${start.day} ${MONTHS[start.month - 1]}`;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
