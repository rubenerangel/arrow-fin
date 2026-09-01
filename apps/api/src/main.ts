import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { devToolsEnabled } from './dev/dev.module';

async function bootstrap(): Promise<void> {
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

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}`);
  logger.log(`Dev fill simulator: ${devToolsEnabled() ? 'ENABLED (non-production only)' : 'not mounted'}`);
}

void bootstrap();
