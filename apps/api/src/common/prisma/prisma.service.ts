import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant.extension';

/**
 * The only PrismaClient in the process.
 *
 * Repositories must go through `prisma.db`, which is the tenant-guarded client. The raw
 * client is intentionally not exported: `new PrismaClient()` anywhere in src/ is a review
 * blocker, because it bypasses the isolation extension entirely.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Tenant-guarded client. Everything in the request path uses this. */
  readonly db = this.$extends(tenantExtension());

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
