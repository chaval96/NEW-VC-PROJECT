import { v4 as uuid } from "uuid";
import { StateStore } from "../domain/store.js";
import type { CreditBalance, CreditTransaction } from "../../shared/types.js";

const CREDITS_PER_PACK = 100;
const PRICE_PER_PACK_USD = 19;

export class CreditService {
  constructor(private readonly store: StateStore) {}

  getBalance(workspaceId: string): CreditBalance {
    const txns = this.store.listCreditTransactions(workspaceId);
    let totalPurchased = 0;
    let totalUsed = 0;

    for (const txn of txns) {
      if (txn.type === "purchase" || txn.type === "refund") {
        totalPurchased += txn.amount;
      } else if (txn.type === "usage") {
        totalUsed += txn.amount;
      }
    }

    return { available: totalPurchased - totalUsed, totalPurchased, totalUsed };
  }

  async recordPurchase(workspaceId: string, packs: number): Promise<CreditTransaction> {
    const credits = packs * CREDITS_PER_PACK;
    const txn: CreditTransaction = {
      id: uuid(),
      workspaceId,
      type: "purchase",
      amount: credits,
      description: `Purchased ${packs} pack(s) — ${credits} credits for $${packs * PRICE_PER_PACK_USD}`,
      createdAt: new Date().toISOString(),
    };

    this.store.addCreditTransaction(txn);
    await this.store.persist();
    return txn;
  }

  async recordUsage(workspaceId: string, amount: number, description: string): Promise<CreditTransaction> {
    const balance = this.getBalance(workspaceId);
    if (balance.available < amount) {
      throw new Error(`Insufficient credits: ${balance.available} available, ${amount} required`);
    }

    const txn: CreditTransaction = {
      id: uuid(),
      workspaceId,
      type: "usage",
      amount,
      description,
      createdAt: new Date().toISOString(),
    };

    this.store.addCreditTransaction(txn);
    await this.store.persist();
    return txn;
  }

  async recordRefund(workspaceId: string, amount: number, description: string): Promise<CreditTransaction> {
    const txn: CreditTransaction = {
      id: uuid(),
      workspaceId,
      type: "refund",
      amount,
      description,
      createdAt: new Date().toISOString(),
    };

    this.store.addCreditTransaction(txn);
    await this.store.persist();
    return txn;
  }

  calculatePrice(packs: number): { credits: number; priceUsd: number } {
    return { credits: packs * CREDITS_PER_PACK, priceUsd: packs * PRICE_PER_PACK_USD };
  }

  listTransactions(workspaceId: string): CreditTransaction[] {
    return this.store.listCreditTransactions(workspaceId);
  }
}
