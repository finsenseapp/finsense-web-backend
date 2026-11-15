/**
 * Timezone-aware date helpers. All "calendar" logic (month boundaries, date-only
 * inputs) uses the app timezone (APP_TIMEZONE, default Asia/Colombo), never the
 * server's local timezone. Functions take the timezone explicitly so they are
 * pure and unit-testable.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` reads the given local time. */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - tzOffsetMs(guess, timeZone);
  // Re-check the offset at the candidate instant (handles DST transitions).
  const second_ = guess - tzOffsetMs(first, timeZone);
  return new Date(second_);
}

/** Calendar year/month (1-12) of an instant in `timeZone`. */
export function yearMonthInZone(instant: Date, timeZone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month") };
}

/** [from, to) range covering a whole month in `timeZone`. */
export function monthRange(year: number, month: number, timeZone: string) {
  const from = zonedTimeToUtc(year, month, 1, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const to = zonedTimeToUtc(nextYear, nextMonth, 1, timeZone);
  return { from, to };
}

/**
 * Parse an API date input.
 * - "YYYY-MM-DD" is the start of that day in `timeZone`.
 * - Any other value must be an ISO date-time and is used as-is.
 * Returns null when the input is not a valid date.
 */
export function parseDateInput(value: string, timeZone: string): Date | null {
  if (isDateOnly(value)) {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = zonedTimeToUtc(y, m, d, timeZone);
    // Reject impossible dates like 2026-02-31 (they roll over into the next month).
    const back = yearMonthInZone(date, timeZone);
    return back.year === y && back.month === m ? date : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Exclusive upper bound for a "to" filter: a date-only value includes that whole day. */
export function parseRangeEnd(value: string, timeZone: string): Date | null {
  const date = parseDateInput(value, timeZone);
  if (!date) return null;
  if (!isDateOnly(value)) return date;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  // Day overflow (e.g. day 32) is normalised by Date.UTC, so this is the next calendar day.
  return zonedTimeToUtc(y, m, d + 1, timeZone);
}

/** Calendar year, month (1-12) and day of an instant in `timeZone`. */
export function ymdInZone(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** YYYY-MM-DD of an instant in `timeZone`. */
export function isoDateInZone(instant: Date, timeZone: string): string {
  const { year, month, day } = ymdInZone(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Number of days in a calendar month (month is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
