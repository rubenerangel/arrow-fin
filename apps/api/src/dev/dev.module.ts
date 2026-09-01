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

/** Single source of truth for whether dev tooling is allowed to exist in this process. */
export function devToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.DEV_TOOLS === 'on';
}
