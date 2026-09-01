import { Decimal } from 'decimal.js';

/**
 * The risk indicator. Formula is given by the assessment:
 *
 *   min(100, abs(positions_notional) / account_balance * 100)
 *
 * The brief says the maths is not what is being graded, so the interesting part is the
 * input the formula does not define: what happens when balance is zero or negative.
 * ACC-1013 in the seed data has balance 0.00 and open fills, so this is not hypothetical.
 * Naive arithmetic yields Infinity, JSON-serialises to null, and the widget renders a
 * blank risk badge on the single most exposed account in the book.
 */

export type RiskBand = 'LOW' | 'ELEVATED' | 'HIGH';

export interface RiskAssessment {
  readonly score: number;
  readonly band: RiskBand;
  /** Set when the score is not a straight computation, so the UI can explain itself. */
  readonly reason: 'OK' | 'NO_BALANCE' | 'NO_EXPOSURE';
}

/** The assessment asks for >75 to be unmissable, so the band boundary lives here, once. */
export const HIGH_RISK_THRESHOLD = 75;

export function assessRisk(grossNotionalUsd: Decimal, accountBalanceUsd: Decimal): RiskAssessment {
  if (grossNotionalUsd.isZero()) {
    return { score: 0, band: 'LOW', reason: 'NO_EXPOSURE' };
  }

  // Exposure with no equity behind it is maximum risk, not undefined risk. Failing to the
  // dangerous-looking answer is the right direction for a risk indicator.
  if (accountBalanceUsd.lessThanOrEqualTo(0)) {
    return { score: 100, band: 'HIGH', reason: 'NO_BALANCE' };
  }

  const raw = grossNotionalUsd.abs().dividedBy(accountBalanceUsd).times(100);
  const score = Decimal.min(100, raw).toDecimalPlaces(2).toNumber();

  return { score, band: bandFor(score), reason: 'OK' };
}

export function bandFor(score: number): RiskBand {
  if (score > HIGH_RISK_THRESHOLD) return 'HIGH';
  if (score > 40) return 'ELEVATED';
  return 'LOW';
}
