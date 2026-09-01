/**
 * Mirrors apps/api/src/snapshot/application/snapshot.dto.ts.
 *
 * Duplicated rather than shared through a workspace package: two apps, one small contract,
 * and a build-time dependency between them would cost more than it saves at this size. If a
 * third consumer appears, generate this from the API instead of hand-syncing it.
 */

export type RiskBand = 'LOW' | 'ELEVATED' | 'HIGH';
export type Direction = 'LONG' | 'SHORT' | 'FLAT';

export interface Position {
  symbol: string;
  description: string;
  netQty: number;
  direction: Direction;
  avgPrice: number;
  markPrice: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  commissionsUsd: number;
  notionalUsd: number;
  fillCount: number;
}

export interface AccountSummary {
  id: string;
  maskedNumber: string;
  accountType: string;
  status: string;
  balanceUsd: number;
}

export interface Snapshot {
  asOf: string;
  sessionStart: string;
  positions: Position[];
  totals: {
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    commissionsUsd: number;
    dayPnlUsd: number;
    grossNotionalUsd: number;
  };
  risk: {
    score: number;
    band: RiskBand;
    reason: 'OK' | 'NO_BALANCE' | 'NO_EXPOSURE';
    threshold: number;
  };
  accounts: AccountSummary[];
  meta: { fillsConsidered: number; accountsIncluded: number; accountsExcluded: number };
}

export interface FillEvent {
  seq: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  filledAt: string;
}

/** What the socket hook reports upward. `stale` is the one that matters. */
export type ConnectionState = 'connecting' | 'live' | 'stale';
