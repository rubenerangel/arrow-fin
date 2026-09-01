import { Module } from '@nestjs/common';
import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './application/snapshot.service';
import {
  ACCOUNT_REPOSITORY,
  FILL_REPOSITORY,
  INSTRUMENT_REPOSITORY,
} from './application/ports';
import { PrismaAccountRepository } from './infrastructure/prisma-account.repository';
import { PrismaFillRepository } from './infrastructure/prisma-fill.repository';
import { PrismaInstrumentRepository } from './infrastructure/prisma-instrument.repository';

@Module({
  controllers: [SnapshotController],
  providers: [
    SnapshotService,
    { provide: ACCOUNT_REPOSITORY, useClass: PrismaAccountRepository },
    { provide: FILL_REPOSITORY, useClass: PrismaFillRepository },
    { provide: INSTRUMENT_REPOSITORY, useClass: PrismaInstrumentRepository },
  ],
  exports: [SnapshotService],
})
export class SnapshotModule {}
