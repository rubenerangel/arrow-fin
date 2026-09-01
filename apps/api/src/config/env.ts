import { config as loadDotenv } from 'dotenv';

/**
 * Load-time configuration.
 *
 * The rule in this codebase is that a consumer receives its dependencies through its
 * constructor - `ConfigService` included. This file is the named exception, and it exists
 * because of a constraint rather than a preference: **decorator arguments and module
 * registration conditions are evaluated at import time, before the DI container exists.**
 * There is no constructor to inject into yet.
 *
 * That gap was a live bug before this file existed. `@WebSocketGateway({ cors: { origin:
 * process.env.CORS_ORIGIN } })` runs when `fills.gateway.ts` is imported, which happens
 * while the `@Module` decorator's `imports` array is still being built - so before
 * `ConfigModule.forRoot()` has read `.env`. The gateway silently fell back to its
 * hardcoded default while the HTTP server, configured inside `bootstrap()`, honoured the
 * file. Same variable, two different values, and nothing to see in the logs.
 *
 * Calling dotenv here fixes the ordering: the first import of this module populates
 * `process.env`, and `ConfigModule` later reads the same already-populated environment.
 *
 * **Which one do I use?**
 * - Runtime, inside a provider → inject `ConfigService` in the constructor. Always.
 * - Import time - decorator metadata, `AppModule` imports, `bootstrap()` → `env` here.
 *
 * If you can inject, inject. This is not a general-purpose config bag.
 */

loadDotenv();

const DEV_JWT_SECRET = 'dev-only-not-a-production-secret';

function read(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export const env = {
  nodeEnv: read('NODE_ENV', 'development'),
  port: Number(read('PORT', '3001')),
  corsOrigin: read('CORS_ORIGIN', 'http://localhost:3000'),
  jwtSecret: read('JWT_SECRET', DEV_JWT_SECRET),
  devTools: read('DEV_TOOLS', 'off'),
} as const;

export const isProduction = (): boolean => env.nodeEnv === 'production';

/**
 * Whether the fill simulator is allowed to exist in this process.
 *
 * Two conditions, not one: production is excluded, and the tool must be switched on
 * explicitly. A single `NODE_ENV !== 'production'` check turns any environment with a
 * missing or misspelt NODE_ENV into one that mounts a write endpoint.
 *
 * Takes its source as a parameter so the rule can be tested without mutating the real
 * environment - see env.spec.ts.
 */
export function devToolsEnabled(source: { nodeEnv: string; devTools: string } = env): boolean {
  return source.nodeEnv !== 'production' && source.devTools === 'on';
}

/**
 * Fails the process at boot rather than serving traffic with a known-bad configuration.
 * Booting with the shipped dev secret means every token this instance issues is forgeable
 * by anyone who has read the repository - that is not a warning, it is a stop.
 */
export function assertProductionConfig(): void {
  if (!isProduction()) return;

  const problems: string[] = [];
  if (env.jwtSecret === DEV_JWT_SECRET) problems.push('JWT_SECRET is still the dev default');
  if (env.devTools === 'on') problems.push('DEV_TOOLS is on');
  if (env.corsOrigin === 'http://localhost:3000') problems.push('CORS_ORIGIN is still localhost');

  if (problems.length > 0) {
    throw new Error(`Refusing to start in production: ${problems.join('; ')}`);
  }
}
