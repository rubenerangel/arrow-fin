import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountRepository, AccountView } from '../application/ports';

@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTrader(traderId: string): Promise<AccountView[]> {
    // No `brokerId` in this where clause, and that is not an oversight: the tenant
    // extension on prisma.db adds it to every query on this model. Writing it here as well
    // would make the test that proves the extension works pass for the wrong reason.
    const rows = await this.prisma.db.account.findMany({
      where: { traderId },
      // Explicit select, not the whole row. The default in this codebase is that a field
      // reaches the application layer because someone typed its name.
      select: {
        id: true,
        accountNumber: true,
        accountType: true,
        status: true,
        balance: true,
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      accountNumber: row.accountNumber,
      accountType: row.accountType,
      status: row.status,
      balance: new Decimal(row.balance.toString()),
    }));
  }
}
