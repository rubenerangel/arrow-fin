/**
 * The wire contract. Hand-written rather than spread from a Prisma row, and that is the
 * point: `return positions.map(p => ({ ...p }))` is how a schema change silently becomes a
 * data disclosure six months later. Every field below was chosen.
 *
 * What is deliberately absent: trader name, email, phone, dob, ssnLast4, address, notes,
 * auditNotes. None of them are needed to render a snapshot, so none of them are selected,
 * mapped, or serialised. Asserted by the PII regression test, not just by this comment.
 */

export interface PositionDto {
  readonly symbol: string;
  readonly description: string;
  readonly netQty: number;
  readonly direction: 'LONG' | 'SHORT' | 'FLAT';
  readonly avgPrice: number;
  /** Null when we hold no mark - the UI shows "no mark", never a fabricated zero. */
  readonly markPrice: number | null;
  readonly realizedPnlUsd: number;
  readonly unrealizedPnlUsd: number;
  readonly commissionsUsd: number;
  readonly notionalUsd: number;
  readonly fillCount: number;
}

export interface AccountSummaryDto {
  readonly id: string;
  /**
   * Masked. The full account number is a payment-adjacent identifier that shows up in
   * support tickets and screenshots; the last three digits are enough for a trader to tell
   * their own accounts apart, which is the only job it has here.
   */
  readonly maskedNumber: string;
  readonly accountType: string;
  readonly status: string;
  /**
   * Regulated under the same rules as the rest of the PII, and returned here only because
   * the account's owner is the one asking and the risk figure is meaningless without it.
   * It is NOT included in WebSocket pushes - see FillsGateway.
   */
  readonly balanceUsd: number;
}

export interface RiskDto {
  readonly score: number;
  readonly band: 'LOW' | 'ELEVATED' | 'HIGH';
  readonly reason: 'OK' | 'NO_BALANCE' | 'NO_EXPOSURE';
  readonly threshold: number;
}

export interface SnapshotDto {
  /** Frozen at the dataset cut via NOW_ISO, so the response is reproducible. */
  readonly asOf: string;
  /** Globex open for the session this snapshot covers. Not midnight UTC. */
  readonly sessionStart: string;
  readonly positions: readonly PositionDto[];
  readonly totals: {
    readonly realizedPnlUsd: number;
    readonly unrealizedPnlUsd: number;
    readonly commissionsUsd: number;
    readonly dayPnlUsd: number;
    readonly grossNotionalUsd: number;
  };
  readonly risk: RiskDto;
  readonly accounts: readonly AccountSummaryDto[];
  readonly meta: {
    readonly fillsConsidered: number;
    readonly accountsIncluded: number;
    /** Closed accounts, reported as a count so the absence of a position is explainable. */
    readonly accountsExcluded: number;
  };
}
