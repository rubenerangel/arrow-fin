import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who the current unit of work belongs to. Populated once, by the JWT guard, from signed
 * claims - never from a route param, query string, header or body. That is the single
 * reason an IDOR cannot be expressed in this codebase: there is no user-supplied input
 * that can reach this object.
 */
export interface TenantPrincipal {
  readonly traderId: string;
  readonly brokerId: string;
}

const tenantStore = new AsyncLocalStorage<TenantPrincipal>();

/**
 * Escape hatch for the handful of code paths that legitimately run without a tenant:
 * the seed script, and the login lookup that resolves a trader BEFORE we know the tenant.
 * It is deliberately noisy to write and easy to grep for.
 */
const systemStore = new AsyncLocalStorage<{ reason: string }>();

export const TenantContext = {
  run<T>(principal: TenantPrincipal, fn: () => T): T {
    return tenantStore.run(principal, fn);
  },

  /**
   * Bind the principal to the current async execution and everything that continues from
   * it. Used by the guard: a Nest guard returns before the handler runs, so `run()` would
   * have exited by then, but `enterWith` keeps the store alive for the rest of the request.
   */
  enter(principal: TenantPrincipal): void {
    tenantStore.enterWith(principal);
  },

  /** Undefined outside a tenant-scoped request. Callers must treat that as fail-closed. */
  get(): TenantPrincipal | undefined {
    return tenantStore.getStore();
  },

  require(): TenantPrincipal {
    const principal = tenantStore.getStore();
    if (!principal) {
      throw new Error('TenantContext.require() called outside a tenant-scoped request');
    }
    return principal;
  },

  /**
   * Run `fn` with tenant enforcement disabled. Every call site must name a reason, and
   * every reason should be boring: seeding, migrations, or resolving identity at login.
   * If you find yourself reaching for this inside a request handler, the design is wrong.
   */
  runAsSystem<T>(reason: string, fn: () => T): T {
    return systemStore.run({ reason }, fn);
  },

  isSystem(): boolean {
    return systemStore.getStore() !== undefined;
  },
};
