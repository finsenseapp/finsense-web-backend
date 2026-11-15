import { env } from "../../config/env.js";
import { notify } from "../../lib/notify.js";
import { prisma } from "../../lib/prisma.js";
import { isoDateInZone, parseDateInput } from "../../utils/dates.js";
import { AppError } from "../../utils/errors.js";
import { Decimal, formatMoney } from "../../utils/money.js";
import { goalProgress } from "./goal-math.js";
import type { ContributionInput, CreateGoalInput, UpdateGoalInput } from "./goals.schemas.js";

type GoalRow = Awaited<ReturnType<typeof prisma.savingsGoal.findFirstOrThrow>>;

function serialize(g: GoalRow, saved: Decimal) {
  const p = goalProgress(g.targetAmount, saved, g.targetDate, new Date(), env.APP_TIMEZONE);
  return {
    id: g.id,
    name: g.name,
    targetAmount: formatMoney(g.targetAmount),
    targetDate: g.targetDate,
    saved: formatMoney(saved),
    remaining: formatMoney(p.remaining),
    percentSaved: p.percentSaved,
    achieved: p.achieved,
    achievedAt: g.achievedAt,
    monthsLeft: p.monthsLeft,
    monthlyNeeded: p.monthlyNeeded ? formatMoney(p.monthlyNeeded) : null,
    createdAt: g.createdAt,
  };
}

async function savedByGoal(userId: string, goalIds: string[]) {
  const sums = new Map<string, Decimal>();
  if (goalIds.length === 0) return sums;
  const groups = await prisma.goalContribution.groupBy({
    by: ["goalId"],
    where: { userId, goalId: { in: goalIds } },
    _sum: { amount: true },
  });
  for (const g of groups) sums.set(g.goalId, g._sum.amount ?? new Decimal(0));
  return sums;
}

async function findOwned(userId: string, id: string) {
  const goal = await prisma.savingsGoal.findFirst({ where: { id, userId } });
  if (!goal) throw AppError.notFound("Goal not found");
  return goal;
}

export async function listGoals(userId: string) {
  const goals = await prisma.savingsGoal.findMany({ where: { userId }, orderBy: [{ achievedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] });
  const saved = await savedByGoal(userId, goals.map((g) => g.id));
  return { data: goals.map((g) => serialize(g, saved.get(g.id) ?? new Decimal(0))) };
}

export async function createGoal(userId: string, input: CreateGoalInput) {
  if (input.targetDate && input.targetDate.getTime() < parseDateInput(isoDateInZone(new Date(), env.APP_TIMEZONE), env.APP_TIMEZONE)!.getTime()) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request", [{ in: "body", path: "targetDate", message: "The target date cannot be in the past" }]);
  }
  const goal = await prisma.savingsGoal.create({
    data: { userId, name: input.name, targetAmount: input.targetAmount, targetDate: input.targetDate ?? null },
  });
  return serialize(goal, new Decimal(0));
}

/** After any change: record (once) that the goal was reached, and tell the user. */
async function checkAchieved(userId: string, goal: GoalRow, saved: Decimal) {
  if (saved.lessThan(goal.targetAmount)) {
    if (goal.achievedAt) await prisma.savingsGoal.update({ where: { id: goal.id }, data: { achievedAt: null } });
    return;
  }
  if (goal.achievedAt) return;
  await prisma.savingsGoal.update({ where: { id: goal.id }, data: { achievedAt: new Date() } });
  await notify(userId, {
    type: "GOAL_REACHED",
    title: `You reached your goal: ${goal.name}`,
    data: { name: goal.name, saved: formatMoney(saved), target: formatMoney(goal.targetAmount) },
    link: "/goals",
    dedupeKey: `goal:${goal.id}`,
  });
}

export async function updateGoal(userId: string, id: string, input: UpdateGoalInput) {
  const existing = await findOwned(userId, id);
  const goal = await prisma.savingsGoal.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.targetAmount !== undefined ? { targetAmount: input.targetAmount } : {}),
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
    },
  });
  const saved = (await savedByGoal(userId, [id])).get(id) ?? new Decimal(0);
  if (input.targetAmount !== undefined && !existing.targetAmount.equals(input.targetAmount)) await checkAchieved(userId, goal, saved);
  const fresh = await prisma.savingsGoal.findUniqueOrThrow({ where: { id } });
  return serialize(fresh, saved);
}

export async function deleteGoal(userId: string, id: string) {
  await findOwned(userId, id);
  await prisma.savingsGoal.delete({ where: { id } }); // the contributions go with it
}

export async function addContribution(userId: string, id: string, input: ContributionInput) {
  const goal = await findOwned(userId, id);
  const current = (await savedByGoal(userId, [id])).get(id) ?? new Decimal(0);
  const signed = input.kind === "ADD" ? new Decimal(input.amount) : new Decimal(input.amount).negated();
  if (current.plus(signed).isNegative()) {
    throw new AppError(400, "INSUFFICIENT_SAVED", "You cannot take out more than you have saved in this goal");
  }
  await prisma.goalContribution.create({
    data: { goalId: id, userId, amount: signed, date: input.date ?? new Date(), note: input.note ?? null },
  });
  const saved = current.plus(signed);
  await checkAchieved(userId, goal, saved);
  const fresh = await prisma.savingsGoal.findUniqueOrThrow({ where: { id } });
  return serialize(fresh, saved);
}

export async function listContributions(userId: string, id: string) {
  await findOwned(userId, id);
  const rows = await prisma.goalContribution.findMany({ where: { goalId: id, userId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200 });
  return {
    data: rows.map((c) => ({ id: c.id, amount: formatMoney(c.amount), date: c.date, note: c.note, createdAt: c.createdAt })),
  };
}

export async function deleteContribution(userId: string, id: string, contributionId: string) {
  const goal = await findOwned(userId, id);
  const row = await prisma.goalContribution.findFirst({ where: { id: contributionId, goalId: id, userId } });
  if (!row) throw AppError.notFound("Contribution not found");
  const current = (await savedByGoal(userId, [id])).get(id) ?? new Decimal(0);
  const after = current.minus(row.amount);
  if (after.isNegative()) {
    throw new AppError(400, "INSUFFICIENT_SAVED", "Removing this would leave the goal with less than nothing saved");
  }
  await prisma.goalContribution.delete({ where: { id: contributionId } });
  await checkAchieved(userId, goal, after);
  const fresh = await prisma.savingsGoal.findUniqueOrThrow({ where: { id } });
  return serialize(fresh, after);
}
