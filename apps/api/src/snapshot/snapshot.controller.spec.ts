import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Decimal } from 'decimal.js';
import request from 'supertest';

import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './application/snapshot.service';
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  AccountView,
  FILL_REPOSITORY,
  FillRepository,
  INSTRUMENT_REPOSITORY,
  InstrumentRepository,
  InstrumentView,
  SNAPSHOT_QUERY,
  SessionFill,
} from './application/ports';
import { TokenService } from '../common/auth/token.service';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { TenantContext } from '../common/tenant/tenant-context';

/**
 * Endpoint tests for GET /api/snapshot.
 *
 * These run the real controller, the real service, the real global guard and the real JSON
 * serialisation, against in-memory repositories. No database, so they are fast and
 * deterministic; the SQL-level enforcement is covered separately by
 * common/prisma/tenant.extension.spec.ts, which tests the actual scoping function.
 *
 * The fakes deliberately consult TenantContext exactly as the Prisma extension does, which
 * makes them a check on the wiring the extension depends on: that the guard turns a signed
 * claim into a bound principal before any repository is touched.
 */

const NOW = '2026-08-25T14:30:00Z';
const SESSION_START = '2026-08-24T22:00:00.000Z';
const JWT_SECRET = 'test-secret';

// --- Fixtures: three tenants, mirroring the shape of the seed data. -------------------

interface SeedAccount extends AccountView {
  traderId: string;
  brokerId: string;
}

const ACCOUNTS: SeedAccount[] = [
  // BRK-MRDN
  {
    id: 'ACC-1011',
    traderId: 'T-009',
    brokerId: 'BRK-MRDN',
    accountNumber: 'MRD-300001',
    accountType: 'funded',
    status: 'active',
    balance: new Decimal('100000'),
  },
  {
    id: 'ACC-1012',
    traderId: 'T-009',
    brokerId: 'BRK-MRDN',
    accountNumber: 'MRD-300002',
    accountType: 'eval',
    status: 'closed',
    balance: new Decimal('31500'),
  },
  {
    // The zero-balance account. Active, and it trades.
    id: 'ACC-1013',
    traderId: 'T-010',
    brokerId: 'BRK-MRDN',
    accountNumber: 'MRD-300003',
    accountType: 'funded',
    status: 'active',
    balance: new Decimal('0'),
  },
  // BRK-SMPT - the other tenant. Nothing from here may ever appear in a Meridian response.
  {
    id: 'ACC-1006',
    traderId: 'T-005',
    brokerId: 'BRK-SMPT',
    accountNumber: 'SMT-200001',
    accountType: 'pro_plus',
    status: 'active',
    balance: new Decimal('150000'),
  },
  // A trader who holds an account but has never traded.
  {
    id: 'ACC-1014',
    traderId: 'T-011',
    brokerId: 'BRK-MRDN',
    accountNumber: 'MRD-300004',
    accountType: 'funded',
    status: 'active',
    balance: new Decimal('25000'),
  },
];

const FILLS: (SessionFill & { brokerId: string })[] = [
  // T-009 / ACC-1011, inside the session.
  fill('ACC-1011', 'BRK-MRDN', 'MES', 'BUY', 10, '5640.00', '2026-08-25T14:12:48Z'),
  fill('ACC-1011', 'BRK-MRDN', 'MES', 'SELL', 10, '5642.00', '2026-08-25T14:20:00Z'),
  fill('ACC-1011', 'BRK-MRDN', 'MCL', 'BUY', 6, '73.95', '2026-08-25T13:00:00Z'),
  // Same account, but BEFORE this session opened. Must not be counted.
  fill('ACC-1011', 'BRK-MRDN', 'MNQ', 'BUY', 4, '19700.00', '2026-08-24T21:59:59Z'),
  // Closed account. Its fills belong to a finished chapter.
  fill('ACC-1012', 'BRK-MRDN', 'MNQ', 'BUY', 3, '19750.00', '2026-08-25T13:30:00Z'),
  // T-010 / ACC-1013 - exposure with a zero balance.
  fill('ACC-1013', 'BRK-MRDN', 'MES', 'BUY', 8, '5640.00', '2026-08-25T13:45:00Z'),
  // Summit. If any of this leaks into a Meridian response the whole exercise is failed.
  fill('ACC-1006', 'BRK-SMPT', 'ES', 'BUY', 20, '5641.00', '2026-08-25T14:00:00Z'),
];

function fill(
  accountId: string,
  brokerId: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: string,
  filledAt: string,
): SessionFill & { brokerId: string } {
  return {
    accountId,
    brokerId,
    instrumentSymbol: symbol,
    side,
    quantity,
    price: new Decimal(price),
    commission: new Decimal('0.70').times(quantity),
    filledAt: new Date(filledAt),
    orderId: `ORD-${accountId}-${filledAt}`,
  };
}

/**
 * What the traders table holds for T-009, in the same shape as the seed CSV - including the
 * unsanitised free-text columns the dataset README warns about twice. None of it is
 * reachable from the snapshot path, and the PII test below proves it by value.
 */
const TRADER_PII = {
  firstName: 'Hannah',
  lastName: 'Whitfield',
  email: 'h.whitfield@meridianfg.example',
  phone: '+1-312-555-0141',
  dob: '1988-07-19',
  ssnLast4: '5521',
  addressLine1: '412 N Clark St Apt 9C',
  postalCode: '60654',
  notes: 'Payout ACH to Chase 000123456789 routing 021000021.',
  auditNotes: 's3://arrowfin-kyc-prod/BRK-MRDN/T-009/passport_scan.jpg',
  accountNumber: 'MRD-300001',
} as const;

/** Every key present anywhere in the response, deduped and sorted. */
function collectKeys(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, found));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      collectKeys(nested, found);
    }
  }
  return [...found].sort();
}

const INSTRUMENTS: InstrumentView[] = [
  { symbol: 'MES', description: 'Micro E-mini S&P 500', pointValueUsd: new Decimal(5), markPrice: new Decimal('5642.25') },
  { symbol: 'MCL', description: 'Micro Crude Oil', pointValueUsd: new Decimal(100), markPrice: new Decimal('74.18') },
  { symbol: 'MNQ', description: 'Micro E-mini Nasdaq-100', pointValueUsd: new Decimal(2), markPrice: new Decimal('19845.50') },
  { symbol: 'ES', description: 'E-mini S&P 500', pointValueUsd: new Decimal(50), markPrice: new Decimal('5642.25') },
];

/**
 * Fakes that enforce the tenant boundary the same way the Prisma extension does: read the
 * principal from the ambient context, refuse to run without one.
 */
class FakeAccountRepository implements AccountRepository {
  async findByTrader(traderId: string): Promise<AccountView[]> {
    const { brokerId } = TenantContext.require();
    return ACCOUNTS.filter((a) => a.traderId === traderId && a.brokerId === brokerId);
  }
}

class FakeFillRepository implements FillRepository {
  async findSessionFills(accountIds: readonly string[], since: Date): Promise<SessionFill[]> {
    const { brokerId } = TenantContext.require();
    return FILLS.filter(
      (f) => f.brokerId === brokerId && accountIds.includes(f.accountId) && f.filledAt >= since,
    ).sort((a, b) => a.filledAt.getTime() - b.filledAt.getTime());
  }
}

class FakeInstrumentRepository implements InstrumentRepository {
  async findBySymbols(symbols: readonly string[]): Promise<InstrumentView[]> {
    return INSTRUMENTS.filter((i) => symbols.includes(i.symbol));
  }
}

// --- Suite ----------------------------------------------------------------------------

describe('GET /api/snapshot', () => {
  let app: INestApplication;
  let tokens: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [SnapshotController],
      providers: [
        // Bound through the port, exactly as SnapshotModule does it. Registering the class
        // directly here would let the controller and the module disagree about their wiring
        // and still have this suite pass.
        { provide: SNAPSHOT_QUERY, useClass: SnapshotService },
        TokenService,
        { provide: ACCOUNT_REPOSITORY, useClass: FakeAccountRepository },
        { provide: FILL_REPOSITORY, useClass: FakeFillRepository },
        { provide: INSTRUMENT_REPOSITORY, useClass: FakeInstrumentRepository },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ NOW_ISO: NOW, JWT_SECRET, JWT_TTL: '1h' })[key as 'NOW_ISO' | 'JWT_SECRET' | 'JWT_TTL'],
          },
        },
        // The real global guard, not a stub - authentication is part of what is under test.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  const asTrader = (traderId: string, brokerId: string) => tokens.sign({ traderId, brokerId });

  describe('happy path', () => {
    it('returns the session snapshot for the trader in the token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      const body = response.body;

      expect(body.asOf).toBe('2026-08-25T14:30:00.000Z');
      // Globex open, not midnight UTC.
      expect(body.sessionStart).toBe(SESSION_START);

      expect(body.positions.map((p: { symbol: string }) => p.symbol).sort()).toEqual(['MCL', 'MES']);

      const mcl = body.positions.find((p: { symbol: string }) => p.symbol === 'MCL');
      expect(mcl.netQty).toBe(6);
      expect(mcl.direction).toBe('LONG');
      // 6 contracts, 0.23 up, 100 dollars a point.
      expect(mcl.unrealizedPnlUsd).toBeCloseTo(138, 2);

      const mes = body.positions.find((p: { symbol: string }) => p.symbol === 'MES');
      expect(mes.netQty).toBe(0);
      expect(mes.direction).toBe('FLAT');
      // 10 lots, 2 points, 5 dollars a point = 100 gross, less 14 of commission.
      expect(mes.realizedPnlUsd).toBeCloseTo(86, 2);

      expect(body.risk).toMatchObject({ band: 'ELEVATED', reason: 'OK', threshold: 75 });
      expect(Number.isFinite(body.risk.score)).toBe(true);
    });

    it('excludes fills from before the session opened', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      // The MNQ fill at 21:59:59Z on the 24th is one second outside the window.
      expect(response.body.positions.map((p: { symbol: string }) => p.symbol)).not.toContain('MNQ');
    });

    it('excludes closed accounts and says how many it dropped', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      expect(response.body.accounts.map((a: { id: string }) => a.id)).toEqual(['ACC-1011']);
      expect(response.body.meta.accountsExcluded).toBe(1);
      // ACC-1012's MNQ fill must not have reached the position engine either.
      expect(response.body.positions.map((p: { symbol: string }) => p.symbol)).not.toContain('MNQ');
    });

    it('reports maximum risk with a reason when the account has no balance', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-010', 'BRK-MRDN')}`)
        .expect(200);

      expect(response.body.risk).toMatchObject({ score: 100, band: 'HIGH', reason: 'NO_BALANCE' });
      // The specific failure this guards against: Infinity serialising to null.
      expect(response.body.risk.score).not.toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it('never returns another tenant data, even though the repository holds it', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      const serialised = JSON.stringify(response.body);

      // Summit's account, its account number prefix, and the full-size ES contract it
      // trades - none of which Meridian holds.
      expect(serialised).not.toContain('ACC-1006');
      expect(serialised).not.toContain('SMT-');
      expect(response.body.positions.map((p: { symbol: string }) => p.symbol)).not.toContain('ES');
    });

    it('scopes by the token claim, not by anything the caller can send', async () => {
      // Same trader id, forged tenant. The repositories filter on brokerId AND traderId,
      // so claiming a tenant you do not belong to yields nothing rather than someone
      // else's book.
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-SMPT')}`)
        .expect(200);

      expect(response.body.positions).toEqual([]);
      expect(response.body.accounts).toEqual([]);
    });

    it('ignores query parameters that look like they might change the subject', async () => {
      // There is no traderId input, so this is inert - but it is worth pinning down, since
      // "add a ?traderId for support tooling" is exactly how this endpoint would regress.
      const response = await request(app.getHttpServer())
        .get('/api/snapshot?traderId=T-005&accountId=ACC-1006&brokerId=BRK-SMPT')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      expect(response.body.accounts.map((a: { id: string }) => a.id)).toEqual(['ACC-1011']);
    });
  });

  describe('authentication', () => {
    it('rejects a request with no token', async () => {
      await request(app.getHttpServer()).get('/api/snapshot').expect(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged = new (require('@nestjs/jwt').JwtService)().sign(
        { sub: 'T-005', bid: 'BRK-SMPT' },
        { secret: 'not-the-secret', algorithm: 'HS256' },
      );
      await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('rejects an alg:none token - the JWT downgrade attack', async () => {
      // Header and payload the attacker controls, empty signature. A verifier that trusts
      // the token's own `alg` header accepts this and hands over the account.
      const b64 = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'T-005', bid: 'BRK-SMPT' })}.`;

      await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${none}`)
        .expect(401);
    });

    it('rejects a token whose payload was edited after signing', async () => {
      const valid = asTrader('T-009', 'BRK-MRDN');
      const [header, , signature] = valid.split('.');
      const tampered = `${header}.${Buffer.from(
        JSON.stringify({ sub: 'T-005', bid: 'BRK-SMPT' }),
      ).toString('base64url')}.${signature}`;

      await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${tampered}`)
        .expect(401);
    });

    it('does not leak why a token failed', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', 'Bearer garbage')
        .expect(401);

      // "expired" vs "bad signature" is a free oracle. Both say the same thing.
      expect(response.body.message).toBe('Invalid or expired token');
    });
  });

  describe('PII', () => {
    /**
     * Regression tests, not shape tests. The failure they are written against is someone
     * replacing the hand-written DTO with a spread of a Prisma row - the exact thing the
     * PR in CODE_REVIEW.md does - at which point every column rides along.
     *
     * Note what this deliberately does NOT do: grep the payload for field-name substrings.
     * That version failed on `grossNotionalUsd`, which contains "ssn". A test that cries
     * wolf on its own vocabulary gets deleted the first time it blocks a release, so it is
     * worse than no test. These two assert on the things that actually matter - the exact
     * set of keys we emit, and the actual PII values sitting in the fixture.
     */
    it('emits exactly the documented key set and nothing else', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      expect(collectKeys(response.body)).toEqual(
        [
          'accountType',
          'accounts',
          'accountsExcluded',
          'accountsIncluded',
          'asOf',
          'avgPrice',
          'balanceUsd',
          'band',
          'commissionsUsd',
          'dayPnlUsd',
          'description',
          'direction',
          'fillCount',
          'fillsConsidered',
          'grossNotionalUsd',
          'id',
          'markPrice',
          'maskedNumber',
          'meta',
          'netQty',
          'notionalUsd',
          'positions',
          'realizedPnlUsd',
          'reason',
          'risk',
          'score',
          'sessionStart',
          'status',
          'symbol',
          'threshold',
          'totals',
          'unrealizedPnlUsd',
        ].sort(),
      );
    });

    it('leaks none of the PII the trader record actually holds', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      const serialised = JSON.stringify(response.body);

      // Real values in the shape the seed data uses, including the free-text fields that
      // carry bank details and a passport scan path.
      for (const value of Object.values(TRADER_PII)) {
        expect(serialised).not.toContain(value);
      }
    });

    it('masks account numbers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-009', 'BRK-MRDN')}`)
        .expect(200);

      expect(response.body.accounts[0].maskedNumber).toBe('MRD-***001');
      expect(JSON.stringify(response.body)).not.toContain('MRD-300001');
    });
  });

  describe('empty and edge states', () => {
    it('returns 200 with an empty snapshot for a trader who has not traded', async () => {
      // Not a 404: "this trader exists but has nothing" and "no such trader" must not be
      // distinguishable, and the widget should render an empty state rather than an error.
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-011', 'BRK-MRDN')}`)
        .expect(200);

      expect(response.body.positions).toEqual([]);
      expect(response.body.totals.dayPnlUsd).toBe(0);
      expect(response.body.risk).toMatchObject({ score: 0, reason: 'NO_EXPOSURE' });
      expect(response.body.accounts).toHaveLength(1);
      expect(response.body.sessionStart).toBe(SESSION_START);
    });

    it('returns 200 with an empty snapshot for a trader with no accounts at all', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/snapshot')
        .set('Authorization', `Bearer ${asTrader('T-999', 'BRK-MRDN')}`)
        .expect(200);

      expect(response.body.positions).toEqual([]);
      expect(response.body.accounts).toEqual([]);
      expect(response.body.meta.accountsIncluded).toBe(0);
    });
  });
});
