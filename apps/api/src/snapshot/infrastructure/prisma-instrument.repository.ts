import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InstrumentRepository, InstrumentView } from '../application/ports';

@Injectable()
export class PrismaInstrumentRepository implements InstrumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reference data - contract specs and marks are the same for every tenant, so this model
   * is intentionally NOT in TENANT_SCOPED_MODELS. Worth stating out loud: the extension is
   * an allowlist of what is tenant-owned, and anything added to the schema that holds
   * customer data must be added to that set too.
   */
  async findBySymbols(symbols: readonly string[]): Promise<InstrumentView[]> {
    if (symbols.length === 0) return [];

    const rows = await this.prisma.db.instrument.findMany({
      where: { symbol: { in: [...symbols] } },
      select: {
        symbol: true,
        description: true,
        pointValueUsd: true,
        marketPrice: { select: { markPrice: true } },
      },
    });

    return rows.map((row) => ({
      symbol: row.symbol,
      description: row.description,
      pointValueUsd: new Decimal(row.pointValueUsd.toString()),
      // Null, not zero. A missing mark is "we do not know", and the DTO carries that
      // through so the UI never renders an invented price as if it were real.
      markPrice: row.marketPrice ? new Decimal(row.marketPrice.markPrice.toString()) : null,
    }));
  }
}
