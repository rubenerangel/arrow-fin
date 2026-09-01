import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';

import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  AccountView,
  FILL_REPOSITORY,
  FillRepository,
  INSTRUMENT_REPOSITORY,
  InstrumentRepository,
  InstrumentView,
  SnapshotQuery,
} from './ports';
import { AccountSummaryDto, PositionDto, SnapshotDto } from './snapshot.dto';
import { buildPositions } from '../domain/positions';
import { totals, valuePosition } from '../domain/pnl';
import { HIGH_RISK_THRESHOLD, assessRisk } from '../domain/risk';
import { sessionStart } from '../domain/session';

/**
 * Accounts a snapshot aggregates. `closed` accounts are excluded: their fills belong to a
 * finished chapter and including them would inflate both P&L and the balance the risk score
 * divides by. `restricted` accounts ARE included - the trader cannot open new risk there but
 * the exposure is live and hiding it is exactly backwards for a risk widget.
 */
const EXCLUDED_ACCOUNT_STATUSES = new Set(['closed']);

/**
 * Implements the SNAPSHOT_QUERY input port. Nothing outside this module holds a reference
 * to this class - the controller and the gateway are wired to the interface - so its
 * internals, and the number of database round trips it makes, stay a private decision.
 */
@Injectable()
export class SnapshotService implements SnapshotQuery {
  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(FILL_REPOSITORY) private readonly fills: FillRepository,
    @Inject(INSTRUMENT_REPOSITORY) private readonly instruments: InstrumentRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * Note the signature: it takes a traderId and nothing else, and the only caller passes
   * the value straight from a verified JWT claim. There is no parameter here that a request
   * could influence, which is the structural reason this endpoint has no IDOR to find.
   *
   * Tenant filtering is absent from this method on purpose. It happens one layer down, in
   * the Prisma extension, applied to every query whether or not the author remembered.
   */
  async forTrader(traderId: string): Promise<SnapshotDto> {
    const now = this.now();
    const start = sessionStart(now);

    const allAccounts = await this.accounts.findByTrader(traderId);
    const included = allAccounts.filter((a) => !EXCLUDED_ACCOUNT_STATUSES.has(a.status));

    if (included.length === 0) {
      // A trader with no tradable account is a valid state, not an error. 200 with an empty
      // snapshot; a 404 here would leak "this trader exists but has nothing" as a
      // distinguishable response.
      return this.empty(now, start, allAccounts, included);
    }

    const sessionFills = await this.fills.findSessionFills(
      included.map((a) => a.id),
      start,
    );

    if (sessionFills.length === 0) {
      return this.empty(now, start, allAccounts, included);
    }

    // Positions net across the trader's accounts. A trader long 2 MES in one account and
    // short 2 MES in another is flat in the index but holds two live contracts, so the
    // exposure that feeds risk is computed per position and summed gross, not netted here.
    const positions = buildPositions(sessionFills);

    const specs = await this.instruments.findBySymbols(positions.map((p) => p.instrumentSymbol));
    const specBySymbol = new Map(specs.map((s) => [s.symbol, s]));

    const valued = positions.map((position) => {
      const spec = specBySymbol.get(position.instrumentSymbol);
      if (!spec) {
        // Unknown contract spec means we cannot convert points to dollars. Treating the
        // point value as 1 would produce a number that is wrong by orders of magnitude and
        // looks fine; failing loudly is the only safe option with money.
        throw new Error(`No instrument spec for ${position.instrumentSymbol}`);
      }
      return valuePosition(position, spec, spec.markPrice);
    });

    const pnl = totals(valued);
    const balance = included.reduce<Decimal>((acc, a) => acc.plus(a.balance), new Decimal(0));
    const risk = assessRisk(pnl.grossNotionalUsd, balance);

    return {
      asOf: now.toISOString(),
      sessionStart: start.toISOString(),
      positions: valued
        .map((v) => toPositionDto(v, specBySymbol.get(v.instrumentSymbol)))
        // Open exposure first, then closed round trips - a trader scanning this cares about
        // what is still live.
        .sort((a, b) => Math.abs(b.netQty) - Math.abs(a.netQty) || a.symbol.localeCompare(b.symbol)),
      totals: {
        realizedPnlUsd: money(pnl.realizedPnlUsd),
        unrealizedPnlUsd: money(pnl.unrealizedPnlUsd),
        commissionsUsd: money(pnl.commissionsUsd),
        dayPnlUsd: money(pnl.dayPnlUsd),
        grossNotionalUsd: money(pnl.grossNotionalUsd),
      },
      risk: { ...risk, threshold: HIGH_RISK_THRESHOLD },
      accounts: included.map(toAccountDto),
      meta: {
        fillsConsidered: sessionFills.length,
        accountsIncluded: included.length,
        accountsExcluded: allAccounts.length - included.length,
      },
    };
  }

  /** "Now" is injected, never read from the system clock. See .env.example NOW_ISO. */
  private now(): Date {
    const frozen = this.config.get<string>('NOW_ISO');
    return frozen ? new Date(frozen) : new Date();
  }

  private empty(
    now: Date,
    start: Date,
    all: readonly AccountView[],
    included: readonly AccountView[],
  ): SnapshotDto {
    const balance = included.reduce<Decimal>((acc, a) => acc.plus(a.balance), new Decimal(0));
    return {
      asOf: now.toISOString(),
      sessionStart: start.toISOString(),
      positions: [],
      totals: {
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        commissionsUsd: 0,
        dayPnlUsd: 0,
        grossNotionalUsd: 0,
      },
      risk: { ...assessRisk(new Decimal(0), balance), threshold: HIGH_RISK_THRESHOLD },
      accounts: included.map(toAccountDto),
      meta: {
        fillsConsidered: 0,
        accountsIncluded: included.length,
        accountsExcluded: all.length - included.length,
      },
    };
  }
}

function toPositionDto(
  valued: ReturnType<typeof valuePosition>,
  spec: InstrumentView | undefined,
): PositionDto {
  return {
    symbol: valued.instrumentSymbol,
    description: spec?.description ?? valued.instrumentSymbol,
    netQty: valued.netQty,
    direction: valued.netQty > 0 ? 'LONG' : valued.netQty < 0 ? 'SHORT' : 'FLAT',
    avgPrice: valued.avgPrice.toDecimalPlaces(6).toNumber(),
    markPrice: valued.markPrice === null ? null : valued.markPrice.toDecimalPlaces(6).toNumber(),
    realizedPnlUsd: money(valued.realizedPnlUsd),
    unrealizedPnlUsd: money(valued.unrealizedPnlUsd),
    commissionsUsd: money(valued.commissionsUsd),
    notionalUsd: money(valued.notionalUsd),
    fillCount: valued.fillCount,
  };
}

function toAccountDto(account: AccountView): AccountSummaryDto {
  return {
    id: account.id,
    maskedNumber: maskAccountNumber(account.accountNumber),
    accountType: account.accountType,
    status: account.status,
    balanceUsd: money(account.balance),
  };
}

/** `APX-100001` -> `APX-***001`. Enough to tell your own accounts apart, and no more. */
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 3) return '***';
  const prefix = accountNumber.slice(0, accountNumber.indexOf('-') + 1);
  return `${prefix}***${accountNumber.slice(-3)}`;
}

/** Decimal money to a JSON number, rounded once, at the edge. */
function money(value: Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}
