import { Module } from '@nestjs/common';
import { FillsGateway } from './fills.gateway';
import { SnapshotModule } from '../snapshot/snapshot.module';

@Module({
  imports: [SnapshotModule],
  providers: [FillsGateway],
  exports: [FillsGateway],
})
export class RealtimeModule {}
