import { Decimal } from 'decimal.js';
import { HIGH_RISK_THRESHOLD, assessRisk } from './risk';

describe('assessRisk', () => {
  it('applies the given formula', () => {
    // 44,508 notional against a 100,000 balance - the real figure for T-009 at the cut.
    const risk = assessRisk(new Decimal('44508'), new Decimal('100000'));
    expect(risk.score).toBeCloseTo(44.51, 2);
    expect(risk.band).toBe('ELEVATED');
    expect(risk.reason).toBe('OK');
  });

  it('caps at 100 rather than reporting 340', () => {
    const risk = assessRisk(new Decimal('340000'), new Decimal('100000'));
    expect(risk.score).toBe(100);
    expect(risk.band).toBe('HIGH');
  });

  /**
   * ACC-1013 in the seed data: balance 0.00, and it has fills. This is the case that turns
   * into Infinity, JSON-serialises to null, and renders a blank risk badge on the single
   * most exposed account in the book.
   */
  it('does not divide by zero when an account has no balance', () => {
    const risk = assessRisk(new Decimal('44508'), new Decimal('0'));

    expect(Number.isFinite(risk.score)).toBe(true);
    expect(risk.score).toBe(100);
    expect(risk.band).toBe('HIGH');
    // The UI needs to be able to say WHY, so this is not silently indistinguishable from
    // a genuine 100.
    expect(risk.reason).toBe('NO_BALANCE');
  });

  it('treats a negative balance as maximum risk too', () => {
    const risk = assessRisk(new Decimal('1000'), new Decimal('-500'));
    expect(risk.score).toBe(100);
    expect(risk.reason).toBe('NO_BALANCE');
  });

  it('reports no exposure as zero, including when the balance is also zero', () => {
    // Flat with no equity is not dangerous, it is just flat. Reporting 100 here would
    // train traders to ignore the indicator, which is worse than not having one.
    const risk = assessRisk(new Decimal('0'), new Decimal('0'));
    expect(risk.score).toBe(0);
    expect(risk.band).toBe('LOW');
    expect(risk.reason).toBe('NO_EXPOSURE');
  });

  it('puts the HIGH band strictly above the threshold the brief calls out', () => {
    expect(assessRisk(new Decimal('75000'), new Decimal('100000')).band).toBe('ELEVATED');
    expect(assessRisk(new Decimal('75500'), new Decimal('100000')).band).toBe('HIGH');
    expect(HIGH_RISK_THRESHOLD).toBe(75);
  });

  it('bands the score that is displayed, not a more precise one behind it', () => {
    // 75.001 rounds to 75.00 for display, and the band follows the rounded value so the
    // badge never contradicts the number next to it. A UI reading "75.00 HIGH" is a bug
    // report; this pins the ordering of round-then-band.
    const risk = assessRisk(new Decimal('75001'), new Decimal('100000'));
    expect(risk.score).toBe(75);
    expect(risk.band).toBe('ELEVATED');
  });
});
