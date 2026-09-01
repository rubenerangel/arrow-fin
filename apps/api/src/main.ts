import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertProductionConfig, devToolsEnabled, env } from './config/env';

async function bootstrap(): Promise<void> {
  // Before anything binds a port. A misconfigured production instance should fail to start,
  // not start and quietly issue forgeable tokens.
  assertProductionConfig();

  const app = await NestFactory.create(AppModule, {
    // Request bodies are never logged. Nest's default logger is fine for lifecycle lines;
    // in production this would be pino with a redaction list, which is called out in
    // SECURITY.md as something deliberately not done here.
    logger: ['error', 'warn', 'log'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips unknown properties instead of passing them through to Prisma. Mass
      // assignment is not exploitable in this codebase today because every write names its
      // fields, but the pipe means it stays that way when someone adds one that does not.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Same source as the WebSocket gateway's decorator, so HTTP and the socket cannot end up
  // on different origin policies - which is exactly what happened when each read
  // process.env at its own point in the startup sequence.
  app.enableCors({ origin: env.corsOrigin, credentials: true });

  await app.listen(env.port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${env.port}`);
  logger.log(`CORS origin: ${env.corsOrigin} (HTTP and WebSocket)`);
  logger.log(`Dev fill simulator: ${devToolsEnabled() ? 'ENABLED (non-production only)' : 'not mounted'}`);
}

void bootstrap();
