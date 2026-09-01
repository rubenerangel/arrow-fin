import { Decimal } from 'decimal.js';
import { DomainFill } from '../domain/positions';

/**
 * Ports. The application layer depends on these interfaces; the Prisma adapters implement
 * them. Two concrete payoffs, not architecture for its own sake:
 *
 * 1. The endpoint tests run against in-memory fakes, so they are fast and deterministic and
 *    still exercise the real service, controller, guard and serialisation.
 * 2. The shapes below are the exhaustive list of fields that leave the database on this
 *    code path. There is no `notes`, no `ssnLast4`, no `email`. A PII leak would require
 *    someone to widen an interface, which is a visible diff.
 */

export const ACCOUNT_REPOSITORY = Symbol('AccountRepository');
export const FILL_REPOSITORY = Symbol('FillRepository');
export const INSTRUMENT_REPOSITORY = Symbol('InstrumentRepository');

export interface AccountView {
  readonly id: string;
  readonly accountNumber: string;
  readonly accountType: string;
  readonly status: string;
  readonly balance: Decimal;
}

export interface AccountRepository {
  /**
   * Accounts held by a trader. Implementations must not filter by broker themselves - the
   * Prisma extension does that, and duplicating it here would hide whether it works.
   */
  findByTrader(traderId: string): Promise<AccountView[]>;
}

export interface SessionFill extends DomainFill {
  readonly accountId: string;
}

export interface FillRepository {
  /** Fills for the given accounts from `since` onwards, ordered by filledAt ascending. */
  findSessionFills(accountIds: readonly string[], since: Date): Promise<SessionFill[]>;
}

export interface InstrumentView {
  readonly symbol: string;
  readonly description: string;
  readonly pointValueUsd: Decimal;
  readonly markPrice: Decimal | null;
}

export interface InstrumentRepository {
  /** Contract specs plus current marks. Reference data, deliberately not tenant-scoped. */
  findBySymbols(symbols: readonly string[]): Promise<InstrumentView[]>;
}
