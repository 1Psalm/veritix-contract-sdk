/**
 * @module modules/recurring
 * RecurringModule — read surface for on-chain recurring/subscription
 * payment schedules (#657, #658, #659).
 *
 * Mirrors `./dispute.ts`'s DisputeModule shape: a small class built around
 * a minimal read-only capability rather than the full client, so it's
 * unit-testable without RPC mocking. Wiring a `readonly recurring = new
 * RecurringModule(...)` property into `VeriTixClient` is a follow-up left
 * for a maintainer, since `client.ts` is shared across several in-flight
 * contributions on this batch.
 */
import type { RecurringRecord } from '../types';
import * as actions from './recurring-actions';
import type { RecurringAmendment, RecurringInvoker } from './recurring-actions';

/** Minimal read capability a `RecurringModule` needs — satisfied by `VeriTixClient`. */
export interface RecurringReader {
  /** Simulates a read-only contract call and returns its decoded native value. */
  simulateRead(method: string, args: unknown[]): Promise<unknown>;
}

/**
 * Decodes a raw `scValToNative`-decoded recurring-schedule struct into a
 * typed {@link RecurringRecord}, normalizing the contract's snake_case
 * fields to the SDK's camelCase surface.
 *
 * @throws {Error} if `raw` is not an object or is missing a required field.
 */
export function decodeRecurringRecord(raw: unknown): RecurringRecord {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('recurring record is not an object');
  }
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const payer = r.payer;
  const payee = r.payee;
  const amount = r.amount;
  const interval = r.interval;
  const active = r.active;
  const paused = r.paused;
  const lastChargedLedger = r.last_charged_ledger ?? r.lastChargedLedger;

  if (
    typeof id !== 'bigint' ||
    typeof payer !== 'string' ||
    typeof payee !== 'string' ||
    typeof amount !== 'bigint' ||
    typeof interval !== 'number' ||
    typeof active !== 'boolean' ||
    typeof paused !== 'boolean' ||
    typeof lastChargedLedger !== 'number'
  ) {
    throw new Error('recurring record is missing one or more required fields');
  }

  return { id, payer, payee, amount, interval, active, paused, lastChargedLedger };
}

/** Computed execution timing for a recurring schedule (#659). */
export interface ExecutionSchedule {
  /** Ledger sequence the most recent charge landed on. */
  lastChargedLedger: number;
  /** Ledger sequence the next charge becomes due. */
  nextDueLedger: number;
  /** Charge interval, in ledgers. */
  intervalLedgers: number;
}

export class RecurringModule {
  constructor(
    private readonly reader: RecurringReader,
    private readonly invoker?: RecurringInvoker
  ) {}

  private requireInvoker(): RecurringInvoker {
    if (!this.invoker) {
      throw new Error('RecurringModule was constructed without a write capability');
    }
    return this.invoker;
  }

  cancel(id: bigint): Promise<void> {
    return actions.cancel(this.requireInvoker(), id);
  }

  cancelBatch(ids: bigint[]) {
    return actions.cancelBatch(this.requireInvoker(), ids);
  }

  pauseRecurring(id: bigint): Promise<void> {
    return actions.pauseRecurring(this.requireInvoker(), id);
  }

  resumeRecurring(id: bigint): Promise<void> {
    return actions.resumeRecurring(this.requireInvoker(), id);
  }

  amendRecurring(id: bigint, amendment: RecurringAmendment): Promise<void> {
    return actions.amendRecurring(this.requireInvoker(), id, amendment);
  }

  transferPayer(id: bigint, newPayer: string): Promise<void> {
    return actions.transferPayer(this.requireInvoker(), id, newPayer);
  }

  /** Returns the recurring schedule for `id`, or `null` on a contract miss. */
  async getRecurring(id: bigint): Promise<RecurringRecord | null> {
    const raw = await this.reader.simulateRead('get_recurring', [id]);
    if (raw === null || raw === undefined) {
      return null;
    }
    return decodeRecurringRecord(raw);
  }

  /** Every recurring schedule where `payer` is the paying party. */
  async getRecurringByPayer(payer: string): Promise<RecurringRecord[]> {
    const raw = await this.reader.simulateRead('get_recurring_by_payer', [payer]);
    if (raw === null || raw === undefined) {
      return [];
    }
    if (!Array.isArray(raw)) {
      throw new Error('get_recurring_by_payer did not return a vector');
    }
    return raw.map(decodeRecurringRecord);
  }

  /** Every recurring schedule where `payee` is the receiving party. */
  async getRecurringByPayee(payee: string): Promise<RecurringRecord[]> {
    const raw = await this.reader.simulateRead('get_recurring_by_payee', [payee]);
    if (raw === null || raw === undefined) {
      return [];
    }
    if (!Array.isArray(raw)) {
      throw new Error('get_recurring_by_payee did not return a vector');
    }
    return raw.map(decodeRecurringRecord);
  }

  /**
   * True when `id`'s schedule is active, not paused, and its next charge
   * is due at or before `nowLedger` (#659).
   */
  async isExecutable(id: bigint, nowLedger: number): Promise<boolean> {
    const record = await this.getRecurring(id);
    if (record === null || !record.active || record.paused) {
      return false;
    }
    return nowLedger >= record.lastChargedLedger + record.interval;
  }

  /** The next-due ledger and interval for `id`'s schedule, or `null` on a miss. */
  async getExecutionSchedule(id: bigint): Promise<ExecutionSchedule | null> {
    const record = await this.getRecurring(id);
    if (record === null) {
      return null;
    }
    return {
      lastChargedLedger: record.lastChargedLedger,
      nextDueLedger: record.lastChargedLedger + record.interval,
      intervalLedgers: record.interval,
    };
  }
}
