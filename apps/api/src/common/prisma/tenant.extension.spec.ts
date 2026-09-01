import { TenantContext } from '../tenant/tenant-context';
import {
  CrossTenantWriteError,
  MissingTenantContextError,
  TENANT_SCOPED_MODELS,
  applyTenantScope,
} from './tenant.extension';

/**
 * The P0 test. A fill delivered to the wrong tenant is the worst outcome in this exercise,
 * and this is the code that makes it structurally hard.
 *
 * It runs against the real scoping function - not a mock of Prisma - so it fails if
 * somebody weakens the rule, which is the only reason to write it.
 */

const MERIDIAN = { traderId: 'T-009', brokerId: 'BRK-MRDN' };
const SUMMIT = { traderId: 'T-005', brokerId: 'BRK-SMPT' };

describe('tenant scoping', () => {
  describe('reads', () => {
    it('injects the caller brokerId into a query that did not ask for it', () => {
      // This is the "someone forgot WHERE broker_id = ?" query, verbatim.
      const scoped = TenantContext.run(MERIDIAN, () =>
        applyTenantScope('Fill', 'findMany', { where: { accountId: 'ACC-1011' } }),
      );

      expect(scoped).toEqual({ where: { accountId: 'ACC-1011', brokerId: 'BRK-MRDN' } });
    });

    it('injects it into a query with no where clause at all', () => {
      const scoped = TenantContext.run(MERIDIAN, () => applyTenantScope('Trader', 'findMany', {}));
      expect(scoped).toEqual({ where: { brokerId: 'BRK-MRDN' } });
    });

    it('overrides a brokerId the caller supplied, so a handler cannot widen its own scope', () => {
      // Even an explicit, deliberate attempt to read another tenant loses to the principal.
      const scoped = TenantContext.run(MERIDIAN, () =>
        applyTenantScope('Fill', 'findMany', { where: { brokerId: 'BRK-SMPT' } }),
      ) as { where: { brokerId: string } };

      expect(scoped.where.brokerId).toBe('BRK-MRDN');
    });

    it('scopes findUnique as well as findMany', () => {
      // The IDOR shape: a valid id belonging to another tenant. Prisma 5 accepts
      // non-unique filters next to the unique selector, so the row simply is not found.
      const scoped = TenantContext.run(MERIDIAN, () =>
        applyTenantScope('Account', 'findUnique', { where: { id: 'ACC-1006' } }),
      );

      expect(scoped).toEqual({ where: { id: 'ACC-1006', brokerId: 'BRK-MRDN' } });
    });

    it('scopes every tenant-owned model', () => {
      for (const model of TENANT_SCOPED_MODELS) {
        const scoped = TenantContext.run(SUMMIT, () =>
          applyTenantScope(model, 'findMany', {}),
        ) as { where: { brokerId: string } };
        expect(scoped.where.brokerId).toBe('BRK-SMPT');
      }
    });

    it('leaves reference data alone', () => {
      // Contract specs and marks are identical for every tenant. Scoping them would break
      // the app; the point is that the allowlist is a decision, not an accident.
      const args = { where: { symbol: 'MES' } };
      expect(TenantContext.run(MERIDIAN, () => applyTenantScope('Instrument', 'findMany', args))).toEqual(
        args,
      );
      expect(TenantContext.run(MERIDIAN, () => applyTenantScope('MarketPrice', 'findMany', args))).toEqual(
        args,
      );
    });
  });

  describe('fail-closed', () => {
    it('throws rather than returning every tenant when there is no principal', () => {
      // The single most important assertion in this file. The alternative default -
      // running the query unscoped - is a silent cross-tenant read.
      expect(() => applyTenantScope('Fill', 'findMany', {})).toThrow(MissingTenantContextError);
      expect(() => applyTenantScope('Trader', 'findMany', {})).toThrow(MissingTenantContextError);
      expect(() => applyTenantScope('Account', 'findFirst', {})).toThrow(MissingTenantContextError);
    });

    it('names the model and operation so the failure is debuggable', () => {
      expect(() => applyTenantScope('Fill', 'findMany', {})).toThrow(/Fill\.findMany/);
    });

    it('lets the seed opt out explicitly, and only inside its own scope', () => {
      const inside = TenantContext.runAsSystem('test: seeding', () =>
        applyTenantScope('Fill', 'findMany', { where: { id: 'FIL-1' } }),
      );
      expect(inside).toEqual({ where: { id: 'FIL-1' } });

      // And the hatch closes behind it.
      expect(() => applyTenantScope('Fill', 'findMany', {})).toThrow(MissingTenantContextError);
    });
  });

  describe('writes', () => {
    it('stamps the caller brokerId onto a create that omitted it', () => {
      const scoped = TenantContext.run(MERIDIAN, () =>
        applyTenantScope('Fill', 'create', { data: { id: 'SIM-1', accountId: 'ACC-1011' } }),
      ) as { data: { brokerId: string } };

      expect(scoped.data.brokerId).toBe('BRK-MRDN');
    });

    it('refuses a write aimed at another tenant instead of silently rewriting it', () => {
      // Silently correcting this would hide a bug. A dev tool that can write across
      // tenants is a tenancy bypass with a friendly name.
      expect(() =>
        TenantContext.run(MERIDIAN, () =>
          applyTenantScope('Fill', 'create', { data: { brokerId: 'BRK-SMPT' } }),
        ),
      ).toThrow(CrossTenantWriteError);
    });

    it('stamps every row of a createMany', () => {
      const scoped = TenantContext.run(SUMMIT, () =>
        applyTenantScope('Fill', 'createMany', { data: [{ id: 'A' }, { id: 'B' }] }),
      ) as { data: { brokerId: string }[] };

      expect(scoped.data.map((row) => row.brokerId)).toEqual(['BRK-SMPT', 'BRK-SMPT']);
    });

    it('scopes deleteMany and updateMany', () => {
      // A missing filter on a bulk delete is how one tenant erases another's data.
      for (const operation of ['deleteMany', 'updateMany']) {
        const scoped = TenantContext.run(MERIDIAN, () =>
          applyTenantScope('Fill', operation, { where: {} }),
        ) as { where: { brokerId: string } };
        expect(scoped.where.brokerId).toBe('BRK-MRDN');
      }
    });
  });

  it('does not mutate the arguments it was given', () => {
    const args = { where: { accountId: 'ACC-1011' } };
    TenantContext.run(MERIDIAN, () => applyTenantScope('Fill', 'findMany', args));
    expect(args).toEqual({ where: { accountId: 'ACC-1011' } });
  });
});
