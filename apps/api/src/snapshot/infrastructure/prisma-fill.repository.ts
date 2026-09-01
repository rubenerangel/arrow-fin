import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FillRepository, SessionFill } from '../application/ports';
import { Side } from '../domain/positions';

@Injectable()
export class PrismaFillRepository implements FillRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The query the composite index exists for:
   *   (broker_id [injected], account_id IN (...), filled_at >= start) ORDER BY filled_at
   *
   * Ordering happens in the database because the index already provides it - sorting 168
   * rows in Node would be free today and would not be at 10^6.
   */
  async findSessionFills(accountIds: readonly string[], since: Date): Promise<SessionFill[]> {
    if (accountIds.length === 0) return [];

    const rows = await this.prisma.db.fill.findMany({
      where: {
        accountId: { in: [...accountIds] },
        filledAt: { gte: since },
      },
      select: {
        accountId: true,
        instrumentSymbol: true,
        side: true,
        quantity: true,
        price: true,
        commission: true,
        filledAt: true,
        orderId: true,
      },
      orderBy: { filledAt: 'asc' },
    });

    return rows.map((row) => ({
      accountId: row.accountId,
      instrumentSymbol: row.instrumentSymbol,
      side: row.side as Side,
      quantity: row.quantity,
      price: new Decimal(row.price.toString()),
      commission: new Decimal(row.commission.toString()),
      filledAt: row.filledAt,
      orderId: row.orderId,
    }));
  }
}
