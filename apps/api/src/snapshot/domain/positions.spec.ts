import { Decimal } from 'decimal.js';
import { DomainFill, buildPositions } from './positions';
import { valuePosition } from './pnl';

/**
 * Protects invariant 4 (money is Decimal, P&L always multiplied by point_value_usd) and
 * the netting rules the dataset README warns about.
 */

let sequence = 0;
function fill(partial: Partial<DomainFill> & Pick<DomainFill, 'side' | 'quantity' | 'price'>): DomainFill {
  sequence += 1;
  return {
    instrumentSymbol: 'MES',
    commission: new Decimal('0.70'),
    filledAt: new Date(Date.UTC(2026, 7, 25, 12, 0, sequence)),
    orderId: `ORD-${sequence}`,
    ...partial,
    price: partial.price,
  };
}

const price = (value: string) => new Decimal(value);

describe('buildPositions', () => {
  it('treats fills sharing an order id as one order, not several', () => {
    // ORD-900185 in the seed data fills in two pieces one second apart. Netting must see
    // a single 10-lot position, not two 5-lot ones with separate average prices.
    const positions = buildPositions([
      fill({ side: 'BUY', quantity: 5, price: price('5610.50'), orderId: 'ORD-900185' }),
      fill({ side: 'BUY', quantity: 5, price: price('5612.50'), orderId: 'ORD-900185' }),
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0].netQty).toBe(10);
    expect(positions[0].avgPrice.toString()).toBe('5611.5');
    expect(positions[0].fillCount).toBe(2);
  });

  it('realises P&L on the closed portion and leaves the remainder open', () => {
    const [position] = buildPositions([
      fill({ side: 'BUY', quantity: 10, price: price('5600') }),
      fill({ side: 'SELL', quantity: 4, price: price('5610') }),
    ]);

    // 4 contracts closed 10 points up; 6 still open at the original average.
    expect(position.realizedPoints.toString()).toBe('40');
    expect(position.netQty).toBe(6);
    expect(position.avgPrice.toString()).toBe('5600');
  });

  it('gets the sign right on a short - the direction factor is not optional', () => {
    const [position] = buildPositions([
      fill({ side: 'SELL', quantity: 2, price: price('5650') }),
      fill({ side: 'BUY', quantity: 2, price: price('5640') }),
    ]);

    // Sold at 5650, bought back at 5640: a short covered lower is a GAIN. Dropping the
    // direction factor reports this as -20 points, and the trader's winning day shows red.
    expect(position.realizedPoints.toString()).toBe('20');
    expect(position.netQty).toBe(0);
  });

  it('flips through zero by closing the old position and opening the rest at the new price', () => {
    const [position] = buildPositions([
      fill({ side: 'BUY', quantity: 2, price: price('5600') }),
      fill({ side: 'SELL', quantity: 5, price: price('5610') }),
    ]);

    expect(position.realizedPoints.toString()).toBe('20'); // 2 closed, 10 points each
    expect(position.netQty).toBe(-3); // 3 now short
    expect(position.avgPrice.toString()).toBe('5610'); // at the flipping fill's price
  });

  it('keeps instruments separate', () => {
    const positions = buildPositions([
      fill({ instrumentSymbol: 'MES', side: 'BUY', quantity: 1, price: price('5600') }),
      fill({ instrumentSymbol: 'MNQ', side: 'BUY', quantity: 1, price: price('19800') }),
    ]);
    expect(positions.map((p) => p.instrumentSymbol).sort()).toEqual(['MES', 'MNQ']);
  });

  it('accumulates commissions per contract per side', () => {
    const [position] = buildPositions([
      fill({ side: 'BUY', quantity: 5, price: price('5600'), commission: new Decimal('3.50') }),
      fill({ side: 'SELL', quantity: 5, price: price('5600'), commission: new Decimal('3.50') }),
    ]);
    // Flat on the day, and still seven dollars down. Commissions are real money.
    expect(position.realizedPoints.toString()).toBe('0');
    expect(position.commissions.toString()).toBe('7');
  });
});

describe('point value', () => {
  /**
   * The trap the dataset README calls out first: MNQ and NQ track the same index and are
   * not the same size. Identical trades, 10x different money.
   */
  it('values the same index move differently for MNQ and NQ', () => {
    const trade = (symbol: string) =>
      buildPositions([
        fill({ instrumentSymbol: symbol, side: 'BUY', quantity: 1, price: price('19800'), commission: new Decimal(0) }),
      ])[0];

    const mark = price('19845.50'); // +45.5 points

    const micro = valuePosition(trade('MNQ'), { symbol: 'MNQ', pointValueUsd: new Decimal(2) }, mark);
    const full = valuePosition(trade('NQ'), { symbol: 'NQ', pointValueUsd: new Decimal(20) }, mark);

    expect(micro.unrealizedPnlUsd.toString()).toBe('91');
    expect(full.unrealizedPnlUsd.toString()).toBe('910');
    expect(full.unrealizedPnlUsd.dividedBy(micro.unrealizedPnlUsd).toNumber()).toBe(10);
  });

  it('nets commissions out of realised P&L', () => {
    const position = buildPositions([
      fill({ side: 'BUY', quantity: 1, price: price('5600'), commission: new Decimal('0.70') }),
      fill({ side: 'SELL', quantity: 1, price: price('5600.50'), commission: new Decimal('0.70') }),
    ])[0];

    const valued = valuePosition(position, { symbol: 'MES', pointValueUsd: new Decimal(5) }, price('5600'));

    // Half a point on one MES is $2.50 gross; $1.40 of commission leaves $1.10 net.
    expect(valued.realizedPnlUsd.toString()).toBe('1.1');
  });

  it('reports no mark as null rather than inventing a zero price', () => {
    const position = buildPositions([fill({ side: 'BUY', quantity: 1, price: price('5600') })])[0];
    const valued = valuePosition(position, { symbol: 'MES', pointValueUsd: new Decimal(5) }, null);

    expect(valued.markPrice).toBeNull();
    // A mark of zero would report a 28,000 dollar loss on a position that is merely unpriced.
    expect(valued.unrealizedPnlUsd.toString()).toBe('0');
    expect(valued.notionalUsd.toString()).toBe('0');
  });
});
