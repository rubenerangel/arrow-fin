import { Module } from '@nestjs/common';
import { DevFillsController } from './dev-fills.controller';
import { RealtimeModule } from '../realtime/realtime.module';

/**
 * Never import this from a module that ships. AppModule adds it conditionally and that
 * condition is the security control - see DevFillsController for the reasoning.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [DevFillsController],
})
export class DevModule {}

// The gate itself lives in src/config/env.ts, with the other import-time configuration.
// Re-exported here so the security control is visible from the module it guards.
export { devToolsEnabled } from '../config/env';
