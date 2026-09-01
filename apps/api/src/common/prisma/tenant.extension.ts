import { Prisma } from '@prisma/client';
import { TenantContext, TenantPrincipal } from '../tenant/tenant-context';

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
 * Who the caller is, as far as scoping is concerned. Passed in rather than read, which is
 * what makes `applyTenantScope` below a pure function of its arguments.
 */
export interface TenantScope {
  /** Undefined outside a tenant-scoped request. */
  readonly principal: TenantPrincipal | undefined;
  /** True inside `TenantContext.runAsSystem` - seeds and the pre-auth login lookup. */
  readonly isSystem: boolean;
}

/**
 * The single point where ambient state is read. Everything downstream of it is pure.
 *
 * Keeping this separate from the decision logic is deliberate: it is one line, it is the
 * only line that depends on where in the async tree we happen to be, and it is the only
 * line that would have to change if the principal ever arrived some other way.
 */
export function currentTenantScope(): TenantScope {
  return { principal: TenantContext.get(), isSystem: TenantContext.isSystem() };
}

/**
 * The load-bearing piece of tenant isolation.
 *
 * Instead of asking every developer to remember `where: { brokerId }` on every query, this
 * runs on EVERY operation on EVERY tenant-scoped model and injects it. The failure mode is
 * the important part: no tenant context means the query throws, not that it returns every
 * tenant's rows. Fail-closed.
 *
 * This is the answer to "if someone forgets a WHERE broker_id = ? six months from now, what
 * catches it?" - nothing needs to catch it, because they cannot express the query. Proven
 * by tenant.extension.spec.ts, not by code review.
 *
 * **It is a pure function**, and for a rule this important that is the point rather than a
 * nicety. It reads no ambient state, mutates nothing, and performs no I/O, so its behaviour
 * is fully determined by four visible arguments. Concretely that buys:
 *
 *  - tests that state the scenario in the call itself, instead of nesting it inside an
 *    AsyncLocalStorage wrapper and hoping the wrapper is doing what it appears to
 *  - no way for a passing test to depend on leftover context from the test before it
 *  - a reviewer can decide whether the rule is right by reading one function, without
 *    tracing where the principal came from
 *
 * It throws on invalid input, which is still deterministic in its arguments - Prisma's
 * middleware contract wants an exception here, and a Result type would be ceremony that
 * every call site immediately unwraps.
 */
export function applyTenantScope(
  model: string | undefined,
  operation: string,
  args: unknown,
  scope: TenantScope,
): unknown {
  if (!model || !TENANT_SCOPED_MODELS.has(model)) {
    return args;
  }

  const { principal } = scope;

  if (!principal) {
    // Seeds and the pre-auth login lookup opt out explicitly and loudly.
    if (scope.isSystem) {
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

/**
 * The impure shell around the pure core: read the ambient scope once, hand it to the rule,
 * pass the result on. Everything worth reviewing is in `applyTenantScope`.
 */
export function tenantExtension() {
  return Prisma.defineExtension({
    name: 'arrowfin-tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = applyTenantScope(model, operation, args, currentTenantScope());
          return query(scoped as typeof args);
        },
      },
    },
  });
}
