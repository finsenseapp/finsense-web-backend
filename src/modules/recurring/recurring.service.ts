import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { notify } from "../../lib/notify.js";
import { prisma } from "../../lib/prisma.js";
import { isoDateInZone, parseDateInput } from "../../utils/dates.js";
import { AppError } from "../../utils/errors.js";
import { formatMoney } from "../../utils/money.js";
import { assertReferences, createTransaction } from "../transactions/transactions.service.js";
import { describeRecurrence, firstOccurrenceOnOrAfter, nextOccurrence } from "./recurrence.js";
import type { CreateRecurringInput, UpdateRecurringInput } from "./recurring.schemas.js";

const include = {
  account: { select: { id: true, name: true, currency: true } },
  toAccount: { select: { id: true, name: true, currency: true } },
  category: { select: { id: true, name: true, icon: true } },
} satisfies Prisma.RecurringRuleInclude;

type Row = Prisma.RecurringRuleGetPayload<{ include: typeof include }>;

const tz = () => env.APP_TIMEZONE;
const startOfToday = (now = new Date()) => parseDateInput(isoDateInZone(now, tz()), tz())!;

function serialize(r: Row) {
  const ended = !!r.endDate && r.nextRunAt.getTime() > r.endDate.getTime();
  return {
    id: r.id,
    type: r.type,
    /** In the currency of the account it is booked on (LKR unless that account holds another currency). */
    amount: formatMoney(r.amount),
    accountCurrency: r.account.currency,
    description: r.description,
    frequency: r.frequency,
    interval: r.interval,
    schedule: describeRecurrence(r, tz()),
    startDate: r.startDate,
    endDate: r.endDate,
    nextRunAt: r.nextRunAt,
    lastRunAt: r.lastRunAt,
    lastError: r.lastError,
    active: r.active,
    /** active = repeating, paused = switched off, ended = past its end date. */
    status: ended ? "ended" : r.active ? "active" : "paused",
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    categoryId: r.categoryId,
    account: r.account,
    toAccount: r.toAccount,
    category: r.category,
    createdAt: r.createdAt,
  };
}

export async function listRules(userId: string) {
  const rows = await prisma.recurringRule.findMany({ where: { userId }, include, orderBy: [{ active: "desc" }, { nextRunAt: "asc" }] });
  return { data: rows.map(serialize) };
}

export async function createRule(userId: string, input: CreateRecurringInput) {
  if (input.startDate.getTime() < startOfToday().getTime()) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request", [
      { in: "body", path: "startDate", message: "The start date cannot be in the past" },
    ]);
  }
  await assertReferences(prisma, userId, input);

  const row = await prisma.recurringRule.create({
    data: {
      userId,
      type: input.type,
      accountId: input.accountId,
      toAccountId: input.toAccountId ?? null,
      categoryId: input.categoryId ?? null,
      amount: input.amount,
      description: input.description,
      frequency: input.frequency,
      interval: input.interval,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      nextRunAt: input.startDate,
    },
    include,
  });
  // A rule that starts today posts today's transaction right away instead of waiting for the next scheduler run.
  await processDueRules({ userId });
  const fresh = await prisma.recurringRule.findUniqueOrThrow({ where: { id: row.id }, include });
  return serialize(fresh);
}

async function findOwned(userId: string, id: string) {
  const row = await prisma.recurringRule.findFirst({ where: { id, userId }, include });
  if (!row) throw AppError.notFound("Recurring transaction not found");
  return row;
}

export async function updateRule(userId: string, id: string, input: UpdateRecurringInput) {
  const existing = await findOwned(userId, id);

  if (input.categoryId !== undefined) {
    await assertReferences(prisma, userId, { type: existing.type, accountId: existing.accountId, toAccountId: existing.toAccountId, categoryId: input.categoryId });
    if (existing.type === "TRANSFER" && input.categoryId) throw AppError.badRequest("A transfer cannot have a category");
    if (existing.type !== "TRANSFER" && !input.categoryId) throw AppError.badRequest("categoryId is required");
  }
  if (input.endDate && input.endDate.getTime() < existing.startDate.getTime()) {
    throw AppError.badRequest("The end date must not be before the start date");
  }

  const data: Prisma.RecurringRuleUpdateInput = {
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.categoryId !== undefined ? { category: input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true } } : {}),
    ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
  };
  if (input.active !== undefined) {
    data.active = input.active;
    data.lastError = null;
    // Resuming never back-fills what was missed while paused: it continues from the next occurrence from today.
    if (input.active && !existing.active) data.nextRunAt = firstOccurrenceOnOrAfter(existing, startOfToday(), tz());
  }
  const row = await prisma.recurringRule.update({ where: { id }, data, include });
  return serialize(row);
}

export async function deleteRule(userId: string, id: string) {
  await findOwned(userId, id);
  await prisma.recurringRule.delete({ where: { id } });
}

// ------------------------------------------------------------ the posting job

/** Most occurrences posted for one rule per run (a server that was off for months catches up over several runs). */
const MAX_PER_RULE_PER_RUN = 12;

/**
 * Posts every occurrence that is due (at the start of the day, in app time) as a normal transaction, so balances,
 * budgets and the dashboard all follow the usual rules. Each occurrence is claimed first with a compare-and-set on
 * `nextRunAt`, so two overlapping runs can never post the same day twice. Returns how many were posted.
 */
export async function processDueRules(opts: { userId?: string; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rules = await prisma.recurringRule.findMany({
    where: { active: true, nextRunAt: { lte: now }, ...(opts.userId ? { userId: opts.userId } : {}) },
    include,
    take: 200,
    orderBy: { nextRunAt: "asc" },
  });

  let posted = 0;
  for (const rule of rules) {
    let occurrence = rule.nextRunAt;
    for (let i = 0; i < MAX_PER_RULE_PER_RUN && occurrence.getTime() <= now.getTime(); i++) {
      if (rule.endDate && occurrence.getTime() > rule.endDate.getTime()) {
        await prisma.recurringRule.update({ where: { id: rule.id }, data: { active: false } });
        break;
      }
      const following = nextOccurrence(rule, occurrence, tz());
      const claim = await prisma.recurringRule.updateMany({
        where: { id: rule.id, active: true, nextRunAt: occurrence },
        data: { nextRunAt: following },
      });
      if (claim.count !== 1) break; // another run took it

      try {
        await createTransaction(rule.userId, {
          type: rule.type,
          accountId: rule.accountId,
          toAccountId: rule.toAccountId,
          categoryId: rule.categoryId,
          amount: rule.amount.toFixed(2),
          description: rule.description,
          date: occurrence,
        });
        await prisma.recurringRule.update({ where: { id: rule.id }, data: { lastRunAt: now, lastError: null } });
        await notify(rule.userId, {
          type: "RECURRING_POSTED",
          title: `${rule.description} was added`,
          data: { amount: formatMoney(rule.amount), accountName: rule.account.name, description: rule.description, date: isoDateInZone(occurrence, tz()) },
          link: "/transactions",
          dedupeKey: `recurring:${rule.id}:${isoDateInZone(occurrence, tz())}`,
        });
        posted++;
        occurrence = following;
      } catch (err) {
        // Give the occurrence back so it is tried again next run, and say why (the job must never crash the server).
        await prisma.recurringRule.update({
          where: { id: rule.id },
          data: { nextRunAt: occurrence, lastError: err instanceof AppError ? err.message : "Could not post this transaction" },
        });
        console.error(`Recurring rule ${rule.id} failed:`, err instanceof Error ? err.message : err);
        break;
      }
    }
  }
  return posted;
}
