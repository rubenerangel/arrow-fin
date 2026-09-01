import { TenantContext } from '../tenant/tenant-context';
import {
  CrossTenantWriteError,
  MissingTenantContextError,
  TENANT_SCOPED_MODELS,
  TenantScope,
  applyTenantScope,
  currentTenantScope,
} from './tenant.extension';

/**
 * The P0 tests. A fill delivered to the wrong tenant is the worst outcome in this exercise,
 * and this is the code that makes it structurally hard.
 *
 * Two suites, split along the pure/impure seam:
 *
 *  - `applyTenantScope` is a pure function, so every scenario is stated in the call itself.
 *    No AsyncLocalStorage wrapper to nest things inside, no chance of a test passing because
 *    of context left behind by the one before it, and a reviewer can check the rule against
 *    these cases without tracing where the principal came from.
 *  - `currentTenantScope` is the one line that reads ambient state, so it gets its own
 *    tests. Splitting the file this way is what stops "the rule is right" and "the rule is
 *    wired to the right context" from being one entangled assertion.
 */

const MERIDIAN: TenantScope = {
  principal: { traderId: 'T-009', brokerId: 'BRK-MRDN' },
  isSystem: false,
};
const SUMMIT: TenantScope = {
  principal: { traderId: 'T-005', brokerId: 'BRK-SMPT' },
  isSystem: false,
};
/** An unauthenticated call, or one that escaped its async context. */
const NO_CONTEXT: TenantScope = { principal: undefined, isSystem: false };
/** The seed script and the pre-auth login lookup. */
const SYSTEM: TenantScope = { principal: undefined, isSystem: true };

describe('applyTenantScope', () => {
  describe('reads', () => {
    it('injects the caller brokerId into a query that did not ask for it', () => {
      // This is the "someone forgot WHERE broker_id = ?" query, verbatim.
      const scoped = applyTenantScope('Fill', 'findMany', { where: { accountId: 'ACC-1011' } }, MERIDIAN);

      expect(scoped).toEqual({ where: { accountId: 'ACC-1011', brokerId: 'BRK-MRDN' } });
    });

    it('injects it into a query with no where clause at all', () => {
      expect(applyTenantScope('Trader', 'findMany', {}, MERIDIAN)).toEqual({
        where: { brokerId: 'BRK-MRDN' },
      });
    });

    it('overrides a brokerId the caller supplied, so a handler cannot widen its own scope', () => {
      // Even an explicit, deliberate attempt to read another tenant loses to the principal.
      const scoped = applyTenantScope(
        'Fill',
        'findMany',
        { where: { brokerId: 'BRK-SMPT' } },
        MERIDIAN,
      ) as { where: { brokerId: string } };

      expect(scoped.where.brokerId).toBe('BRK-MRDN');
    });

    it('scopes findUnique as well as findMany', () => {
      // The IDOR shape: a valid id belonging to another tenant. Prisma 5 accepts non-unique
      // filters next to the unique selector, so the row simply is not found.
      const scoped = applyTenantScope('Account', 'findUnique', { where: { id: 'ACC-1006' } }, MERIDIAN);

      expect(scoped).toEqual({ where: { id: 'ACC-1006', brokerId: 'BRK-MRDN' } });
    });

    it('scopes every tenant-owned model', () => {
      for (const model of TENANT_SCOPED_MODELS) {
        const scoped = applyTenantScope(model, 'findMany', {}, SUMMIT) as {
          where: { brokerId: string };
        };
        expect(scoped.where.brokerId).toBe('BRK-SMPT');
      }
    });

    it('leaves reference data alone', () => {
      // Contract specs and marks are identical for every tenant. Scoping them would break
      // the app; the point is that the allowlist is a decision, not an accident.
      const args = { where: { symbol: 'MES' } };
      expect(applyTenantScope('Instrument', 'findMany', args, MERIDIAN)).toEqual(args);
      expect(applyTenantScope('MarketPrice', 'findMany', args, MERIDIAN)).toEqual(args);
    });
  });

  describe('fail-closed', () => {
    it('throws rather than returning every tenant when there is no principal', () => {
      // The single most important assertion in this file. The alternative default - running
      // the query unscoped - is a silent cross-tenant read.
      expect(() => applyTenantScope('Fill', 'findMany', {}, NO_CONTEXT)).toThrow(
        MissingTenantContextError,
      );
      expect(() => applyTenantScope('Trader', 'findMany', {}, NO_CONTEXT)).toThrow(
        MissingTenantContextError,
      );
      expect(() => applyTenantScope('Account', 'findFirst', {}, NO_CONTEXT)).toThrow(
        MissingTenantContextError,
      );
    });

    it('names the model and operation so the failure is debuggable', () => {
      expect(() => applyTenantScope('Fill', 'findMany', {}, NO_CONTEXT)).toThrow(/Fill\.findMany/);
    });

    it('lets the seed opt out explicitly', () => {
      expect(applyTenantScope('Fill', 'findMany', { where: { id: 'FIL-1' } }, SYSTEM)).toEqual({
        where: { id: 'FIL-1' },
      });
    });
  });

  describe('writes', () => {
    it('stamps the caller brokerId onto a create that omitted it', () => {
      const scoped = applyTenantScope(
        'Fill',
        'create',
        { data: { id: 'SIM-1', accountId: 'ACC-1011' } },
        MERIDIAN,
      ) as { data: { brokerId: string } };

      expect(scoped.data.brokerId).toBe('BRK-MRDN');
    });

    it('refuses a write aimed at another tenant instead of silently rewriting it', () => {
      // Silently correcting this would hide a bug. A dev tool that can write across tenants
      // is a tenancy bypass with a friendly name.
      expect(() =>
        applyTenantScope('Fill', 'create', { data: { brokerId: 'BRK-SMPT' } }, MERIDIAN),
      ).toThrow(CrossTenantWriteError);
    });

    it('stamps every row of a createMany', () => {
      const scoped = applyTenantScope(
        'Fill',
        'createMany',
        { data: [{ id: 'A' }, { id: 'B' }] },
        SUMMIT,
      ) as { data: { brokerId: string }[] };

      expect(scoped.data.map((row) => row.brokerId)).toEqual(['BRK-SMPT', 'BRK-SMPT']);
    });

    it('scopes deleteMany and updateMany', () => {
      // A missing filter on a bulk delete is how one tenant erases another's data.
      for (const operation of ['deleteMany', 'updateMany']) {
        const scoped = applyTenantScope('Fill', operation, { where: {} }, MERIDIAN) as {
          where: { brokerId: string };
        };
        expect(scoped.where.brokerId).toBe('BRK-MRDN');
      }
    });
  });

  describe('purity', () => {
    it('does not mutate the arguments it was given', () => {
      const args = { where: { accountId: 'ACC-1011' } };
      applyTenantScope('Fill', 'findMany', args, MERIDIAN);
      expect(args).toEqual({ where: { accountId: 'ACC-1011' } });
    });

    it('returns the same result for the same inputs, in any order', () => {
      const call = (scope: TenantScope) =>
        applyTenantScope('Fill', 'findMany', { where: { accountId: 'ACC-1011' } }, scope);

      const first = call(MERIDIAN);
      call(SUMMIT); // interleaved call with a different tenant
      expect(call(MERIDIAN)).toEqual(first);
    });

    it('depends on nothing but its arguments', () => {
      // Called from inside a Summit context and told it is Meridian: the argument wins.
      // If this ever fails, some ambient read has crept back into the rule.
      const scoped = TenantContext.run({ traderId: 'T-005', brokerId: 'BRK-SMPT' }, () =>
        applyTenantScope('Fill', 'findMany', {}, MERIDIAN),
      ) as { where: { brokerId: string } };

      expect(scoped.where.brokerId).toBe('BRK-MRDN');
    });
  });
});

/**
 * The impure line, tested on its own. This is what connects the rule above to a real
 * request, and it is the half that a pure-function test cannot cover.
 */
describe('currentTenantScope', () => {
  it('reports no principal outside a request', () => {
    expect(currentTenantScope()).toEqual({ principal: undefined, isSystem: false });
  });

  it('reports the principal bound by the guard', () => {
    const scope = TenantContext.run({ traderId: 'T-009', brokerId: 'BRK-MRDN' }, () =>
      currentTenantScope(),
    );
    expect(scope.principal).toEqual({ traderId: 'T-009', brokerId: 'BRK-MRDN' });
    expect(scope.isSystem).toBe(false);
  });

  it('reports the system escape hatch, and closes it again afterwards', () => {
    expect(TenantContext.runAsSystem('test: seeding', () => currentTenantScope()).isSystem).toBe(
      true,
    );
    // The hatch must not leak into whatever runs next.
    expect(currentTenantScope().isSystem).toBe(false);
  });

  it('composes with the rule to fail closed on a request with no principal', () => {
    // The end-to-end shape of the P0, through both halves.
    expect(() => applyTenantScope('Fill', 'findMany', {}, currentTenantScope())).toThrow(
      MissingTenantContextError,
    );
  });
});
