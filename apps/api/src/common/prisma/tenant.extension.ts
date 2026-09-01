import { Prisma } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Models carrying the denormalised tenant key. Anything listed here is unreachable
 * without a tenant principal; anything not listed is reference data (Instrument,
 * MarketPrice) or the tenant root itself (Broker).
 *
 * Adding a tenant-owned model and forgetting to add it here is the one gap in this
 * design. It is covered by a schema-drift test rather than by hoping people remember.
 */
export const TENANT_SCOPED_MODELS = new Set<string>(['Trader', 'Account', 'Fill']);

/** Operations whose `where` we can safely narrow. */
const FILTERED_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
]);

/** Operations that write new rows and must be stamped with the caller's tenant. */
const STAMPED_OPERATIONS = new Set<string>(['create', 'createMany', 'upsert']);

export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Refusing to run ${model}.${operation}() without a tenant context. ` +
        'Tenant-scoped models can only be queried inside TenantContext.run(), or ' +
        'explicitly inside TenantContext.runAsSystem() with a stated reason.',
    );
    this.name = 'MissingTenantContextError';
  }
}

export class CrossTenantWriteError extends Error {
  constructor(model: string, attempted: string, actual: string) {
    super(
      `Refusing to write ${model} for broker ${attempted} while acting as ${actual}.`,
    );
    this.name = 'CrossTenantWriteError';
  }
}

function stampBrokerId(model: string, data: unknown, brokerId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => stampBrokerId(model, row, brokerId));
  }
  if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>;
    if (row.brokerId !== undefined && row.brokerId !== brokerId) {
      throw new CrossTenantWriteError(model, String(row.brokerId), brokerId);
    }
    return { ...row, brokerId };
  }
  return data;
}

/**
 * The load-bearing piece of tenant isolation, extracted from the Prisma plumbing so it can
 * be tested for real rather than through a mock of a mock. `tenantExtension()` below is a
 * thin wrapper; this function is where every decision is made.
 *
 * Instead of asking every developer to remember `where: { brokerId }` on every query, this
 * runs on EVERY operation on EVERY tenant-scoped model and injects it. The failure mode is
 * the important part: no tenant context means the query throws, not that it returns every
 * tenant's rows. Fail-closed.
 *
 * This is the answer to "if someone forgets a WHERE broker_id = ? six months from now, what
 * catches it?" - nothing needs to catch it, because they cannot express the query. Proven
 * by tenant.extension.spec.ts, not by code review.
 */
export function applyTenantScope(
  model: string | undefined,
  operation: string,
  args: unknown,
): unknown {
  if (!model || !TENANT_SCOPED_MODELS.has(model)) {
    return args;
  }

  const principal = TenantContext.get();

  if (!principal) {
    // Seeds and the pre-auth login lookup opt out explicitly and loudly.
    if (TenantContext.isSystem()) {
      return args;
    }
    throw new MissingTenantContextError(model, operation);
  }

  const next = { ...((args as Record<string, unknown>) ?? {}) };

  if (FILTERED_OPERATIONS.has(operation)) {
    // Prisma 5+ accepts non-unique filters alongside a unique selector, so this works
    // uniformly for findUnique as well as findMany.
    next.where = { ...((next.where as object) ?? {}), brokerId: principal.brokerId };
  }

  if (STAMPED_OPERATIONS.has(operation)) {
    if (next.data !== undefined) {
      next.data = stampBrokerId(model, next.data, principal.brokerId);
    }
    if (next.create !== undefined) {
      next.create = stampBrokerId(model, next.create, principal.brokerId);
    }
  }

  return next;
}

export function tenantExtension() {
  return Prisma.defineExtension({
    name: 'arrowfin-tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(applyTenantScope(model, operation, args) as typeof args);
        },
      },
    },
  });
}
