import { Module } from '@nestjs/common';
import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './application/snapshot.service';
import {
  ACCOUNT_REPOSITORY,
  FILL_REPOSITORY,
  INSTRUMENT_REPOSITORY,
  SNAPSHOT_QUERY,
} from './application/ports';
import { PrismaAccountRepository } from './infrastructure/prisma-account.repository';
import { PrismaFillRepository } from './infrastructure/prisma-fill.repository';
import { PrismaInstrumentRepository } from './infrastructure/prisma-instrument.repository';

@Module({
  controllers: [SnapshotController],
  providers: [
    // The composition root for this feature: the one file that knows which class satisfies
    // which port. Everything else in the module names a token.
    { provide: SNAPSHOT_QUERY, useClass: SnapshotService },
    { provide: ACCOUNT_REPOSITORY, useClass: PrismaAccountRepository },
    { provide: FILL_REPOSITORY, useClass: PrismaFillRepository },
    { provide: INSTRUMENT_REPOSITORY, useClass: PrismaInstrumentRepository },
  ],
  // The token, not the class. RealtimeModule gets the use case without a compile-time
  // dependency on how it is implemented.
  exports: [SNAPSHOT_QUERY],
})
export class SnapshotModule {}
