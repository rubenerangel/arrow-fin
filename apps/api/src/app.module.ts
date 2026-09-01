import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from './common/prisma/prisma.module';
import { AuthCoreModule } from './common/auth/auth.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { SnapshotModule } from './snapshot/snapshot.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DevModule, devToolsEnabled } from './dev/dev.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthCoreModule,
    AuthModule,
    SnapshotModule,
    RealtimeModule,
    // The fill simulator is not a route guarded at runtime - it is a module that does not
    // exist in a production build's dependency graph. See DevFillsController.
    ...(devToolsEnabled() ? [DevModule] : []),
  ],
  providers: [
    // Global. Authentication is the default for every route in the application and
    // @Public() is the documented, greppable exception.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
