import { Decimal } from "../../utils/money.js";

export type TxType = "INCOME" | "EXPENSE" | "TRANSFER";

/** The fields of a transaction that affect account balances. */
export interface BalanceTx {
  type: TxType;
  accountId: string;
  toAccountId?: string | null;
  /** The value in LKR. */
  amount: Decimal | string | number;
  /** The exact amount in the account's own currency. Absent or null for an LKR account: then `amount` is used. */
  accountAmount?: Decimal | string | number | null;
  /** What the destination of a transfer receives, in its currency. Absent or null: then `amount` is used. */
  toAmount?: Decimal | string | number | null;
}

export interface BalanceEffect {
  accountId: string;
  delta: Decimal;
}

/**
 * Balance effect of a single transaction (CLAUDE.md section 5):
 *   INCOME   -> account += amount
 *   EXPENSE  -> account -= amount
 *   TRANSFER -> account -= amount, toAccount += amount
 * Each account moves by the amount in its own currency: `accountAmount` (foreign account) or `amount` (LKR account);
 * a transfer credits `toAmount` or `amount`. Pure: no I/O, exact Decimal arithmetic.
 */
export function computeBalanceEffects(tx: BalanceTx): BalanceEffect[] {
  const amount = new Decimal(tx.accountAmount ?? tx.amount);
  const credited = new Decimal(tx.toAmount ?? tx.amount);
  switch (tx.type) {
    case "INCOME":
      return [{ accountId: tx.accountId, delta: amount }];
    case "EXPENSE":
      return [{ accountId: tx.accountId, delta: amount.negated() }];
    case "TRANSFER":
      if (!tx.toAccountId) throw new Error("TRANSFER requires toAccountId");
      return [
        { accountId: tx.accountId, delta: amount.negated() },
        { accountId: tx.toAccountId, delta: credited },
      ];
  }
}

/** The effects that undo a transaction. */
export function reverseEffects(effects: BalanceEffect[]): BalanceEffect[] {
  return effects.map((e) => ({ accountId: e.accountId, delta: e.delta.negated() }));
}

/** Combine effects per account, summing deltas and dropping accounts that net to zero. */
export function mergeEffects(...lists: BalanceEffect[][]): BalanceEffect[] {
  const byAccount = new Map<string, Decimal>();
  for (const list of lists) {
    for (const { accountId, delta } of list) {
      byAccount.set(accountId, (byAccount.get(accountId) ?? new Decimal(0)).plus(delta));
    }
  }
  return [...byAccount.entries()]
    .filter(([, delta]) => !delta.isZero())
    .map(([accountId, delta]) => ({ accountId, delta }));
}

/** Update = reverse the old effect, then apply the new one (net per account). */
export function computeUpdateEffects(oldTx: BalanceTx, newTx: BalanceTx): BalanceEffect[] {
  return mergeEffects(reverseEffects(computeBalanceEffects(oldTx)), computeBalanceEffects(newTx));
}

/** Delete = reverse the effect. */
export function computeDeleteEffects(tx: BalanceTx): BalanceEffect[] {
  return mergeEffects(reverseEffects(computeBalanceEffects(tx)));
}
