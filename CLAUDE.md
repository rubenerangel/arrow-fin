# Architecture

This is both the context file for coding agents and the architecture document for people.
If you are picking this repo up, read this first and `SECURITY.md` second.

## The one-paragraph version

One feature: a trader's daily snapshot — open positions, day P&L, and a risk indicator —
served over REST and updated over a WebSocket. Two customer types share the infrastructure,
so `brokerId` is the tenant key and a cross-tenant read is a P0. The interesting engineering
is not the arithmetic; it is that tenant isolation is enforced by the data layer rather than
by everyone remembering, and that the money maths is in pure functions you can actually test.

## Layers

```
        transport            application              domain
  ┌────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
  │ SnapshotController │→ │ SnapshotService  │→ │ session.ts           │
  │ AuthController     │  │ ports.ts         │  │ positions.ts         │
  │ FillsGateway (WS)  │  │ snapshot.dto.ts  │  │ pnl.ts               │
  │ DevFillsController │  └──────────────────┘  │ risk.ts              │
  └────────────────────┘           ↑            └──────────────────────┘
            │                      │                       no imports
            ↓                      │                       out of here
  ┌────────────────────┐  ┌──────────────────┐
  │ JwtAuthGuard       │  │ Prisma*Repository│ ── implements the ports
  │ TenantContext      │  │ PrismaService    │ ── tenant extension lives here
  └────────────────────┘  └──────────────────┘
```

Dependencies point inward. The domain knows nothing about NestJS, Prisma, HTTP or the
clock; the application layer knows the domain and a set of interfaces; the infrastructure
implements those interfaces. That is the whole of the hexagonal story here — there is no
CQRS, no event bus, no mediator. Adding one would be architecture for its own sake at this
size.

## Invariants

These are not style preferences. Each one exists because breaking it produces a specific
bad outcome, and each one has a test.

**1. No route takes a subject identifier.** There is no `:traderId`, no `:accountId`, no
`?traderId=`. Identity comes from a verified JWT claim via `@CurrentUser()`. An IDOR is not
"prevented" here, it is unexpressible — there is nowhere in the request to put someone
else's id. Guarded by the tenant-isolation tests in `snapshot.controller.spec.ts`.

**2. Every query goes through `PrismaService.db`.** `new PrismaClient()` anywhere in `src/`
is a review blocker: it bypasses the tenant extension entirely. The seed script is the one
exception, and it runs from a shell, not from a request.

**3. `snapshot/domain/**` imports nothing from NestJS or Prisma.** It is the testable
frontier — pure functions over plain values. If you find yourself wanting a repository in
there, the logic belongs in the application layer instead.

**4. Money is `Decimal`, and P&L is always multiplied by `point_value_usd`.** MNQ and NQ
track the same index at $2 and $20 a point. Any P&L written as `(mark - avg) * qty` is wrong
by 10x for one of them and looks entirely reasonable on screen. `pnl.ts` is the only place
points become dollars.

**5. No PII crosses the wire.** Not over HTTP, not over the WebSocket, not into a log line.
The DTO in `snapshot.dto.ts` is hand-written for exactly this reason — `return { ...row }`
is how a schema change silently becomes a data disclosure. Account numbers are masked.

**6. `now` is injected, never read.** `NOW_ISO` in config. The domain never calls
`new Date()`, which is what makes the snapshot deterministic against a frozen dataset and
the session-boundary tests possible at all.

## Data model

Six tables. Two decisions worth knowing about:

**`brokerId` is denormalised onto `accounts` and `fills`** even though it is reachable by
join (`fill → account → trader → broker`). The tenant key on every row a request can touch
means isolation never depends on someone writing a three-table join correctly, and it lets
the client extension enforce the rule mechanically on any query. The cost is write-time
consistency, paid once in the seed and once in `applyTenantScope`'s stamping.

**`fills(broker_id, account_id, filled_at)`** is the index to explain. The snapshot query is
literally `WHERE broker_id = $1 AND account_id IN (...) AND filled_at >= $start ORDER BY
filled_at`. Tenant first because the extension always adds it; account next because it is
the selective column; `filled_at` last so the session window is a range scan on the index
tail and the `ORDER BY` needs no sort. An index on `filled_at` alone scans every tenant's
fills for the session and discards most of them — the shape that looks fine on 687 rows.

## Tenant isolation, concretely

`TenantContext` is an `AsyncLocalStorage` holding `{ traderId, brokerId }`, populated once
by `JwtAuthGuard` from signed claims. `PrismaService.db` is the client extended with
`tenantExtension()`, which calls `applyTenantScope()` on every operation:

- tenant-scoped model + principal present → inject `brokerId` into `where`, stamp it on writes
- tenant-scoped model + no principal → **throw**, not "return everything"
- reference data (`Instrument`, `MarketPrice`) → untouched

Two things to know before you touch it:

- **`TENANT_SCOPED_MODELS` is an allowlist.** Adding a model that holds customer data and
  forgetting to add it there is the one real gap in this design.
- **`runAsSystem()` must `await` inside its callback.** Prisma promises are lazy; returning
  one and awaiting it outside runs the query after the async context has unwound, and the
  extension correctly refuses it. `AuthService.login` has the comment.

## Conventions

- **A new read use case**: add a method to a port in `application/ports.ts`, implement it in
  `infrastructure/`, orchestrate in the service, and keep the calculation in `domain/`.
- **A new tenant-owned table**: add the model, add `brokerId` to it, add its name to
  `TENANT_SCOPED_MODELS`, and add a case to `tenant.extension.spec.ts`.
- **A new instrument**: it is data, not code. Add rows to `instruments.csv` and
  `market_prices.csv` and re-seed.
- **Never log a request or response body.** Ids only. `FillsGateway` shows the pattern.

## Running it

```bash
docker compose up -d                        # postgres on 5435
cd apps/api
cp .env.example .env
npm install
npm run prisma:generate && npm run prisma:push
npm run seed                                # 3 brokers, 14 traders, 18 accounts, 687 fills
npm test                                    # 52 tests, no database needed
npm run build && node dist/main.js
```

## Tests, and which invariant each one holds up

| Spec | Holds up |
| --- | --- |
| `common/prisma/tenant.extension.spec.ts` | The P0. Injection, override, fail-closed, cross-tenant write refusal |
| `snapshot/snapshot.controller.spec.ts` | Invariants 1 and 5 — isolation end to end, auth rejection, PII by value, empty states |
| `snapshot/domain/session.spec.ts` | Invariant 6 and the 17:00 CT session boundary, including DST |
| `snapshot/domain/positions.spec.ts` | Invariant 4 — netting, short sign, flip through zero, MNQ vs NQ |
| `snapshot/domain/risk.spec.ts` | The zero-balance account, and the display/band ordering |

## Known debt and deliberate cuts

Listed so nobody "fixes" something that was a decision. The reasoning for each is in
`README.md` and `SECURITY.md`:

- No RLS in Postgres. The Prisma extension is one barrier; a second one below it is the
  first thing I would add with more time.
- No replay buffer on the socket. Clients detect a gap via `seq` and refetch; the server
  cannot re-send what a disconnected client missed.
- Login takes an email and no password. There is no password in the dataset and inventing a
  hash column would have been theatre.
- `prisma db push` rather than migrations. Fine for an assessment, not for a team.
- No rate limiting, no audit log, no structured log redaction. All named in `SECURITY.md`
  as production work that was consciously skipped, not overlooked.
