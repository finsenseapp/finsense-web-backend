import { prisma } from "../../lib/prisma.js";
import { getRates } from "../../services/ratesService.js";
import { AppError } from "../../utils/errors.js";
import { Decimal, formatMoney } from "../../utils/money.js";
import { toSkipTake, type Pagination } from "../../utils/pagination.js";
import type { CreateAccountInput, UpdateAccountInput } from "./accounts.schemas.js";

type AccountRow = Awaited<ReturnType<typeof prisma.account.findFirstOrThrow>>;

type PerLkr = Record<string, number> | null;

/** The latest rates, but only when a foreign account needs them (LKR-only users never wait for the rates service). */
async function ratesFor(rows: AccountRow[]): Promise<PerLkr> {
  if (!rows.some((a) => a.currency !== "LKR")) return null;
  return getRates().then((r) => r.rates, () => null);
}

/** What a balance is worth in LKR at the latest rate (null if the rate is not known right now). */
function balanceInLkr(a: AccountRow, rates: PerLkr): Decimal | null {
  if (a.currency === "LKR") return a.balance;
  const perLkr = rates?.[a.currency];
  return perLkr ? a.balance.div(perLkr).toDecimalPlaces(2) : null;
}

function serialize(a: AccountRow, rates: PerLkr = null) {
  const inLkr = balanceInLkr(a, rates);
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    /** The account's own currency (LKR unless the account was created in another one). */
    currency: a.currency,
    /** In the account's own currency. */
    balance: formatMoney(a.balance),
    /** The same balance in LKR at the latest rate (equals `balance` for an LKR account). */
    balanceLkr: inLkr ? formatMoney(inLkr) : null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

const duplicateName = () => AppError.conflict("You already have an account with this name");

function isCode(err: unknown, code: string) {
  return (err as { code?: string })?.code === code;
}

export async function listAccounts(userId: string, p: Pagination) {
  const where = { userId };
  const [rows, total] = await Promise.all([
    prisma.account.findMany({ where, orderBy: { createdAt: "asc" }, ...toSkipTake(p) }),
    prisma.account.count({ where }),
  ]);
  const rates = await ratesFor(rows);
  return { data: rows.map((r) => serialize(r, rates)), meta: { page: p.page, pageSize: p.pageSize, total } };
}

async function findOwned(userId: string, id: string) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw AppError.notFound("Account not found");
  return account;
}

export async function getAccount(userId: string, id: string) {
  const row = await findOwned(userId, id);
  return serialize(row, await ratesFor([row]));
}

/** Total of all balances in LKR: foreign balances are converted at the latest rate. One query, a rate lookup only if needed. */
export async function totalBalanceLkr(userId: string): Promise<Decimal> {
  const groups = await prisma.account.groupBy({ by: ["currency"], where: { userId }, _sum: { balance: true } });
  let total = new Decimal(0);
  let rates: Record<string, number> | null = null;
  for (const g of groups) {
    const sum = g._sum.balance ?? new Decimal(0);
    if (g.currency === "LKR") {
      total = total.plus(sum);
      continue;
    }
    rates ??= (await getRates()).rates;
    const perLkr = rates[g.currency];
    if (perLkr) total = total.plus(sum.div(perLkr));
  }
  return total.toDecimalPlaces(2);
}

export async function createAccount(userId: string, input: CreateAccountInput) {
  try {
    const account = await prisma.account.create({
      data: { userId, name: input.name, type: input.type, currency: input.currency, balance: input.openingBalance },
    });
    return serialize(account, await ratesFor([account]));
  } catch (err) {
    if (isCode(err, "P2002")) throw duplicateName();
    throw err;
  }
}

export async function updateAccount(userId: string, id: string, input: UpdateAccountInput) {
  await findOwned(userId, id);
  try {
    // Ownership was verified by findOwned above.
    const account = await prisma.account.update({
      where: { id },
      data: { name: input.name, type: input.type },
    });
    return serialize(account, await ratesFor([account]));
  } catch (err) {
    if (isCode(err, "P2002")) throw duplicateName();
    throw err;
  }
}

const hasTransactionsError = () =>
  AppError.conflict("This account has transactions and cannot be deleted");

export async function deleteAccount(userId: string, id: string) {
  await findOwned(userId, id);

  const used = await prisma.transaction.count({
    where: { userId, OR: [{ accountId: id }, { toAccountId: id }] },
  });
  if (used > 0) throw hasTransactionsError();

  try {
    await prisma.account.delete({ where: { id } });
  } catch (err) {
    // A transaction was created between the check and the delete: FK Restrict wins.
    if (isCode(err, "P2003")) throw hasTransactionsError();
    throw err;
  }
}
