import { Decimal } from 'decimal.js';

/**
 * Position building from raw executions. Pure - no NestJS, no Prisma, no clock, no I/O.
 * That is the invariant that makes this file the one place worth writing careful tests
 * against, and the reason the interesting logic does not live in a controller.
 */

export type Side = 'BUY' | 'SELL';

/** The only fill fields the domain needs. Notably: no PII, no account metadata. */
export interface DomainFill {
  readonly instrumentSymbol: string;
  readonly side: Side;
  readonly quantity: number;
  readonly price: Decimal;
  readonly commission: Decimal;
  readonly filledAt: Date;
  /** Fills sharing an orderId are one order filled in pieces. Kept for audit, not netting. */
  readonly orderId: string;
}

export interface PositionState {
  readonly instrumentSymbol: string;
  /** Signed: positive is long, negative is short, zero is flat but traded. */
  readonly netQty: number;
  /** Weighted average cost of the open contracts. Zero when flat. */
  readonly avgPrice: Decimal;
  /** Realised P&L in index POINTS. Money needs the instrument's point value applied. */
  readonly realizedPoints: Decimal;
  /** Commissions paid on this symbol, in USD. Already money - per contract, per side. */
  readonly commissions: Decimal;
  readonly fillCount: number;
  readonly lastFillAt: Date;
}

const ZERO = new Decimal(0);

function signedQty(fill: DomainFill): number {
  return fill.side === 'BUY' ? fill.quantity : -fill.quantity;
}

/**
 * Net a chronological stream of fills into one state per instrument, using weighted
 * average cost. Realised P&L accrues when a fill reduces an existing position; a fill that
 * flips the position through zero realises the closed portion and opens the remainder at
 * the fill price.
 *
 * Fills must be sorted by filledAt. The caller does that in SQL, where the composite index
 * already provides the order.
 */
export function buildPositions(fills: readonly DomainFill[]): PositionState[] {
  const bySymbol = new Map<string, MutablePosition>();

  for (const fill of fills) {
    const position = bySymbol.get(fill.instrumentSymbol) ?? newPosition(fill.instrumentSymbol);
    applyFill(position, fill);
    bySymbol.set(fill.instrumentSymbol, position);
  }

  return [...bySymbol.values()].map(freeze);
}

interface MutablePosition {
  instrumentSymbol: string;
  netQty: number;
  avgPrice: Decimal;
  realizedPoints: Decimal;
  commissions: Decimal;
  fillCount: number;
  lastFillAt: Date;
}

function newPosition(instrumentSymbol: string): MutablePosition {
  return {
    instrumentSymbol,
    netQty: 0,
    avgPrice: ZERO,
    realizedPoints: ZERO,
    commissions: ZERO,
    fillCount: 0,
    lastFillAt: new Date(0),
  };
}

function applyFill(position: MutablePosition, fill: DomainFill): void {
  const delta = signedQty(fill);

  position.commissions = position.commissions.plus(fill.commission);
  position.fillCount += 1;
  if (fill.filledAt > position.lastFillAt) {
    position.lastFillAt = fill.filledAt;
  }

  const opening = position.netQty === 0 || Math.sign(position.netQty) === Math.sign(delta);

  if (opening) {
    const existing = Math.abs(position.netQty);
    const added = Math.abs(delta);
    position.avgPrice = position.avgPrice
      .times(existing)
      .plus(fill.price.times(added))
      .dividedBy(existing + added);
    position.netQty += delta;
    return;
  }

  // Reducing, closing, or flipping.
  const direction = Math.sign(position.netQty); // +1 was long, -1 was short
  const closedQty = Math.min(Math.abs(position.netQty), Math.abs(delta));

  // Long closed above cost is a gain; short closed below cost is a gain. The `direction`
  // factor is what makes shorts come out with the right sign - dropping it is the most
  // common way this calculation is quietly wrong.
  position.realizedPoints = position.realizedPoints.plus(
    fill.price.minus(position.avgPrice).times(closedQty).times(direction),
  );

  position.netQty += delta;

  if (position.netQty === 0) {
    position.avgPrice = ZERO;
  } else if (Math.sign(position.netQty) !== direction) {
    // Flipped through zero: the remainder is a brand new position at this fill's price.
    position.avgPrice = fill.price;
  }
}

function freeze(position: MutablePosition): PositionState {
  return {
    instrumentSymbol: position.instrumentSymbol,
    netQty: position.netQty,
    avgPrice: position.avgPrice,
    realizedPoints: position.realizedPoints,
    commissions: position.commissions,
    fillCount: position.fillCount,
    lastFillAt: position.lastFillAt,
  };
}
