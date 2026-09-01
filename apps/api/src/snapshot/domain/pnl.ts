import { Decimal } from 'decimal.js';
import { PositionState } from './positions';

/**
 * Points to money. Pure.
 *
 * The whole file exists because of one line in the dataset README: "MNQ and NQ track the
 * same index and are not the same size." Both quote around 19,845. A one-point move is $2
 * on MNQ and $20 on NQ. Any P&L expressed as (mark - avg) * qty is wrong by 10x for one of
 * them, and looks perfectly reasonable on screen. Every conversion goes through
 * pointValueUsd here so there is exactly one place to get it wrong.
 */

export interface InstrumentSpec {
  readonly symbol: string;
  readonly pointValueUsd: Decimal;
}

export interface ValuedPosition {
  readonly instrumentSymbol: string;
  readonly netQty: number;
  readonly avgPrice: Decimal;
  /** Null when we hold no mark for the symbol - not zero. See markPrice handling below. */
  readonly markPrice: Decimal | null;
  readonly realizedPnlUsd: Decimal;
  readonly unrealizedPnlUsd: Decimal;
  readonly commissionsUsd: Decimal;
  /** Absolute exposure in USD. Drives the risk indicator. */
  readonly notionalUsd: Decimal;
  readonly fillCount: number;
  readonly lastFillAt: Date;
}

const ZERO = new Decimal(0);

/**
 * Realised P&L is net of commissions. Commissions are real money, charged per contract per
 * side, and a day that looks green gross can be red net - which is the number a trader
 * actually cares about.
 */
export function valuePosition(
  position: PositionState,
  spec: InstrumentSpec,
  markPrice: Decimal | null,
): ValuedPosition {
  const pointValue = spec.pointValueUsd;

  const realizedGross = position.realizedPoints.times(pointValue);
  const realizedPnlUsd = realizedGross.minus(position.commissions);

  // No mark means we cannot value the open exposure. Reporting zero would render as a flat
  // day and hide the risk; the field stays null and the caller surfaces it as unknown.
  const unrealizedPnlUsd =
    markPrice === null || position.netQty === 0
      ? ZERO
      : markPrice.minus(position.avgPrice).times(position.netQty).times(pointValue);

  const notionalUsd =
    markPrice === null
      ? ZERO
      : markPrice.times(Math.abs(position.netQty)).times(pointValue);

  return {
    instrumentSymbol: position.instrumentSymbol,
    netQty: position.netQty,
    avgPrice: position.avgPrice,
    markPrice,
    realizedPnlUsd,
    unrealizedPnlUsd,
    commissionsUsd: position.commissions,
    notionalUsd,
    fillCount: position.fillCount,
    lastFillAt: position.lastFillAt,
  };
}

export interface PnlTotals {
  readonly realizedPnlUsd: Decimal;
  readonly unrealizedPnlUsd: Decimal;
  readonly commissionsUsd: Decimal;
  readonly dayPnlUsd: Decimal;
  readonly grossNotionalUsd: Decimal;
}

export function totals(positions: readonly ValuedPosition[]): PnlTotals {
  const realizedPnlUsd = sum(positions.map((p) => p.realizedPnlUsd));
  const unrealizedPnlUsd = sum(positions.map((p) => p.unrealizedPnlUsd));

  return {
    realizedPnlUsd,
    unrealizedPnlUsd,
    commissionsUsd: sum(positions.map((p) => p.commissionsUsd)),
    dayPnlUsd: realizedPnlUsd.plus(unrealizedPnlUsd),
    // Gross, not net: a long ES and a short NQ are two exposures, not a hedge. Netting
    // them would understate risk.
    grossNotionalUsd: sum(positions.map((p) => p.notionalUsd)),
  };
}

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, value) => acc.plus(value), ZERO);
}
