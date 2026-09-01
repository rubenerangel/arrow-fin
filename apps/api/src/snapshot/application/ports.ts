import { Decimal } from 'decimal.js';
import { DomainFill } from '../domain/positions';
import { SnapshotDto } from './snapshot.dto';

/**
 * Ports. The application layer depends on these interfaces; the adapters implement them.
 * Two concrete payoffs, not architecture for its own sake:
 *
 * 1. The endpoint tests run against in-memory fakes, so they are fast and deterministic and
 *    still exercise the real service, controller, guard and serialisation.
 * 2. The output-port shapes below are the exhaustive list of fields that leave the database
 *    on this code path. There is no `notes`, no `ssnLast4`, no `email`. A PII leak would
 *    require someone to widen an interface, which is a visible diff.
 *
 * Tokens are `Symbol`, not strings: two modules cannot collide on the same name by
 * accident, and a typo is a compile error rather than a provider that silently resolves to
 * something else at runtime.
 */

// --- Input port: what the transport layer is allowed to ask the application to do -------

export const SNAPSHOT_QUERY = Symbol('SnapshotQuery');

/**
 * The only way into this feature from the outside. Both drivers - the HTTP controller and
 * the WebSocket gateway - depend on this interface rather than on the concrete service.
 *
 * The signature is the security argument as much as the architectural one: it takes a
 * trader id and nothing else, so there is no parameter through which a caller could widen
 * the subject of the query. Anyone adding an overload with an `accountId` or a `brokerId`
 * has to change this file, and that shows up in review as a change to the feature's
 * contract instead of as a detail inside a service method.
 */
export interface SnapshotQuery {
  forTrader(traderId: string): Promise<SnapshotDto>;
}

// --- Output ports: what the application needs the outside world to provide --------------

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
