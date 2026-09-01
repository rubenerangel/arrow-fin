import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { IsIn, IsNumber, IsPositive, IsString, Matches, Max } from 'class-validator';
import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { TenantPrincipal } from '../common/tenant/tenant-context';
import { FillsGateway } from '../realtime/fills.gateway';
import { ConfigService } from '@nestjs/config';

class SimulateFillDto {
  @IsString()
  @Matches(/^ACC-\d{4}$/)
  accountId!: string;

  @IsString()
  @Matches(/^[A-Z0-9]{1,6}$/)
  instrumentSymbol!: string;

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @IsNumber()
  @IsPositive()
  @Max(100)
  quantity!: number;

  @IsNumber()
  @IsPositive()
  price!: number;

  @IsNumber()
  commissionUsd!: number;
}

/**
 * Option 1 from dataset/simulate-fills.md: an endpoint you call yourself.
 *
 * Three things stop this being a production liability, in order of how much I trust them:
 *
 * 1. The module is not registered at all unless NODE_ENV !== 'production' AND DEV_TOOLS ===
 *    'on' (see AppModule). In production the route does not exist - it 404s like any other
 *    unknown path, because there is no handler compiled into the container's route table.
 *    A runtime `if (isProd) throw` would still leave the route mounted and one config
 *    mistake away from live.
 * 2. It is behind the same global auth guard as everything else, so it cannot be used
 *    anonymously even in dev.
 * 3. It writes through prisma.db under the caller's tenant context, so the extension stamps
 *    brokerId from the token. A simulated fill for another tenant's account is rejected by
 *    the same code that protects the read path - a dev tool cannot become a tenancy bypass.
 */
@Controller('dev')
export class DevFillsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: FillsGateway,
    private readonly config: ConfigService,
  ) {}

  @Post('fills')
  async simulate(@CurrentUser() principal: TenantPrincipal, @Body() body: SimulateFillDto) {
    // Belt and braces: even in dev, the account must belong to the caller. The extension
    // already scopes this read to the tenant, so a foreign account simply is not found.
    const account = await this.prisma.db.account.findFirst({
      where: { id: body.accountId, traderId: principal.traderId },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException('Unknown account');
    }

    const filledAt = new Date(this.config.get<string>('NOW_ISO') ?? Date.now());

    await this.prisma.db.fill.create({
      data: {
        id: `SIM-${randomUUID().slice(0, 8)}`,
        accountId: account.id,
        // brokerId omitted on purpose - the tenant extension stamps it from the token.
        instrumentSymbol: body.instrumentSymbol,
        side: body.side,
        quantity: body.quantity,
        price: new Decimal(body.price).toString(),
        commission: new Decimal(body.commissionUsd).toString(),
        filledAt,
        orderId: `SIM-${randomUUID().slice(0, 8)}`,
        liquidity: 'taker',
      } as never,
    });

    const { seq } = await this.gateway.publishFill(principal, {
      symbol: body.instrumentSymbol,
      side: body.side,
      quantity: body.quantity,
      price: body.price,
      filledAt: filledAt.toISOString(),
    });

    return { ok: true, seq };
  }
}
