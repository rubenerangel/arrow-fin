# Security & PII

Threat model for the Trader Daily Snapshot. Every claim below points at a line you can open.

The assumption throughout: **a valid, authenticated user of one tenant is the attacker.**
Not an anonymous internet stranger — a real prop-firm trader with a working login who
changes an id in a URL to see what happens. That is the realistic threat for a B2B platform
on shared infrastructure, and it is the one that turns into a reportable incident.

---

## 1. Auth model

**REST.** `POST /auth/login` returns a JWT signed HS256, carrying `{ sub: traderId, bid:
brokerId }` and nothing else. The frontend sends it as a bearer token. `JwtAuthGuard` is
registered as `APP_GUARD` in `app.module.ts`, so **authentication is the default for every
route** and `@Public()` is the documented exception. This ordering matters more than it
looks: a route added six months from now by someone who never read this file is protected,
and forgetting the decorator makes an endpoint *unreachable*, not *open*.

`brokerId` is read from the trader row on the server and signed in — the client never states
which tenant it belongs to, so it cannot claim a different one
(`auth/auth.service.ts`).

**WebSocket.** The same token, in the Socket.IO handshake `auth` payload, verified in
`FillsGateway.handleConnection` — **at connection time, not per message.** A socket that
fails verification is disconnected before it joins any room and before a single byte is
emitted, so it never reaches a state where a broadcast could find it.

Not in the query string, deliberately: query strings land in access logs, proxy logs and
browser history, and a bearer token in a log file is a credential at rest.

**What stops a trader from one tenant subscribing to another tenant's stream:**
there is no subscribe event. `FillsGateway` has no `@SubscribeMessage` handler at all. Room
membership is a server decision made once, from a verified claim:

```ts
client.principal = principal;
await client.join(roomFor(principal.traderId));   // fills.gateway.ts
```

A client cannot ask for a stream, so it cannot ask for someone else's. Compare this with the
usual shape — `socket.on('subscribe', ({ accountId }) => socket.join(accountId))` — where
the security of the whole system rests on remembering to check ownership inside that
callback. Removing the client's ability to influence routing is stronger than validating
what it asks for, because there is nothing left to get wrong.

The gateway also validates through the *same* `TokenService.verify()` as the REST guard.
One verification path means the WebSocket cannot drift into being the weaker door.

---

## 2. Tenant isolation

**Where it is enforced:** `src/common/prisma/tenant.extension.ts`, on every query, in the
data layer.

`TenantContext` is an `AsyncLocalStorage` holding the principal, bound by the guard. The
Prisma client is extended so that `applyTenantScope()` runs on every operation on every
tenant-owned model:

```ts
if (!principal) {
  if (scope.isSystem) return args;
  throw new MissingTenantContextError(model, operation);   // fail-closed
}
next.where = { ...next.where, brokerId: principal.brokerId };
```

`scope` is a parameter, not something the function reaches for. `applyTenantScope` is pure —
no ambient reads, no mutation, no I/O — and the single line that touches
`AsyncLocalStorage` lives in `currentTenantScope()` beside it. For the one rule in this
codebase that must not be wrong, that means the rule can be reviewed and tested in isolation
from the plumbing that feeds it, and a test cannot pass because of context another test left
behind.

Note what it does with a `brokerId` the caller supplied: **overwrites it.** A handler cannot
widen its own scope even deliberately.

> **If someone on your team forgets a `WHERE broker_id = ?` six months from now, what
> catches it?**

Nothing has to. They cannot express the query. `PrismaAccountRepository.findByTrader` is
literally `where: { traderId }` with no tenant clause — the extension adds it. I left it
that way on purpose: writing the filter in the repository too would make the isolation test
pass for the wrong reason and hide whether the mechanism actually works.

And the failure direction is the point. The alternative default — run the query unscoped
when there is no context — is a silent cross-tenant read that no one notices. Here it throws
with the model and operation named. I hit this myself during the build: login failed closed
because a lazy Prisma promise escaped its context. The mechanism caught its own author on
day one, which is roughly the evidence you want.

**Proof, not assertion.** `tenant.extension.spec.ts` covers injection, the override, write
stamping, refusal of a cross-tenant write, and the fail-closed throw.
`snapshot.controller.spec.ts` runs the real controller and guard against repositories
holding all three brokers' data and asserts that a Meridian token returns none of Summit's —
including when the token carries a forged tenant claim, and when the URL is decorated with
`?traderId=T-005&accountId=ACC-1006&brokerId=BRK-SMPT`.

**The gap, stated plainly.** `TENANT_SCOPED_MODELS` is an allowlist. A new table holding
customer data that nobody adds to that set is not protected. Mitigations in order of what I
would actually do: a schema-drift test asserting every model with a `brokerId` column is in
the set, and below that, Postgres RLS as a second barrier that does not depend on the
application being right (see §5).

---

## 3. PII

**What I treated as sensitive.** The structured columns are the obvious half: `firstName`,
`lastName`, `email`, `phone`, `dob`, `ssnLast4`, address, `postalCode`. Regulated under
CFTC/NFA, and `ssnLast4` + `dob` + address is a KYC-grade identity set on its own.

The higher-risk half is `notes` and `audit_notes` on `traders`, and the dataset README warns
about them twice for good reason. Actual contents:

- `Payout ACH to Chase 000123456789 routing 021000021.` — bank credentials, in free text
- `KYC packet at s3://arrowfin-kyc-prod/BRK-ARWP/T-001/passport_scan.jpg` — a path to a
  passport scan, and the bucket name tells an attacker where the rest of them live
- `Compliance flag 2026-02-11: SSN on file did not match W-9... case CS-2026-0188` — an open
  compliance matter, which is sensitive in a second dimension: disclosing it is not just a
  privacy breach, it is telling a customer they are under review
- A third party's phone number, typed by an agent who was being helpful

These are worse than the structured columns precisely because they are unstructured. You
cannot write a redaction rule for "whatever a support agent typed", so the only defensible
treatment is that **the fields have no read path outside a compliance tool.** They are
loaded by the seed because the exercise is about handling this data honestly rather than
pretending it does not exist, and they are never selected by anything else.

**What is logged.** Nothing that identifies a person. The gateway logs
`trader=T-009 broker=BRK-MRDN` and no more. No request bodies, no response bodies, no tokens
— `main.ts` uses the plain logger and never logs payloads. `AuthController.login` logs
nothing at all: a failed-login line containing an email is a PII record with a different
retention policy than the database it came from.

**What is redacted.** Account numbers are masked at the DTO boundary — `MRD-300001` becomes
`MRD-***001` (`maskAccountNumber` in `snapshot.service.ts`). Enough to tell your own accounts
apart, which is the only job it has in this UI. Full numbers show up in screenshots and
support tickets, so the shorter form is the one that should exist in the client.

**DB vs WebSocket — what changes.** In the database the PII is at rest, access-controlled,
and auditable, and I would encrypt the worst of it (§5). Over the WebSocket it is *in
motion, fanned out, and repeated*: a socket frame is delivered to whoever is in the room,
buffered by intermediaries, and kept in browser memory. So the socket payload is the
narrowest thing that does the job — symbol, side, quantity, price, timestamp, sequence:

```ts
export interface FillEventDto {
  seq; symbol; side; quantity; price; filledAt;   // fills.gateway.ts
}
```

Balance is the interesting boundary case. The brief lists account balances as regulated, and
they are returned over REST because the account's owner is the one asking and the risk score
is meaningless without the denominator. They are **not** pushed over the socket — a
recomputed `riskScore` carries the same information the widget needs with none of the value.

---

## 4. One vulnerability I did not introduce: IDOR

The most likely bug in this feature, and the one the PR in `CODE_REVIEW.md` actually has.

The natural design is `GET /api/positions/:accountId`, and then the security of the whole
endpoint depends on remembering an ownership check inside every handler that takes an id.
That check gets forgotten. It is the single most common authorization bug in B2B SaaS.

The line that prevents it:

```ts
@Get('snapshot')
async snapshot(@CurrentUser() principal: TenantPrincipal): Promise<SnapshotDto> {
  return this.snapshots.forTrader(principal.traderId);
}
```

There is no `:traderId`, no `:accountId`, no `?traderId=`. `SnapshotService.forTrader` takes
a trader id and its only caller passes a value that came from a verified signature. **There
is no input in the request that can reach the subject of the query.** Not "the check is
there" — there is nothing to check, because there is nothing to supply. That property holds
without anyone maintaining it, which is the difference between a design choice and a
convention.

The follow-up is where this usually breaks: someone needs support tooling, adds
`?traderId=` "just for admins", and the property is gone. `snapshot.controller.spec.ts` pins
it down with a request carrying exactly those params, asserting the response is unchanged.
The right shape for that requirement is a separate, separately-authorized admin endpoint.

**Second, smaller one — log injection.** The reviewed PR interpolates a user-controlled
`accountId` straight into a log message. Newlines in that value forge log lines, which is
how you make an intrusion look like a routine 200 in whatever the SOC is reading. Nothing in
this codebase interpolates user input into a log message; the only interpolated values are
ids from verified claims.

**Third — JWT downgrade.** `TokenService.verify()` pins `algorithms: ['HS256']`. Without it
the verifier honours whatever the token's own header asks for, and an attacker re-signs with
`alg: none` and walks in as anyone. That is one option object away from being a critical
bug, and it is covered by a test that submits an `alg: none` token.

---

## 5. What I would do in production and did not

**Rate limiting.** `@nestjs/throttler` on `/auth/login` keyed by IP + email, and a
connection-rate limit on the WebSocket handshake. Right now login is an unauthenticated
endpoint that does a database lookup per request — that is both a credential-stuffing target
and a cheap way to load the database.

**Audit logging.** An append-only log of every access to a trader record: who, what, when,
from where. Not application logs — a separate store with its own retention, because under
CFTC/NFA the question after an incident is "who read this and when", and application logs
cannot answer it.

**Structured redaction in the logger.** pino with an explicit `redact` list covering
`notes`, `auditNotes`, `ssnLast4`, `email`, `phone`, `authorization`. Today the protection is
that nobody logs objects; a redaction list means it stays safe when somebody does.

**Encryption for the worst columns.** `ssnLast4`, `dob`, `notes`, `auditNotes` encrypted
with a KMS-managed key, decrypted only by the compliance service. It does not stop an
application bug, but it takes a leaked database dump from "reportable incident" to
"ciphertext".

**Postgres RLS underneath the extension.** A `broker_id = current_setting('app.broker_id')`
policy with the setting established per connection. The Prisma extension is application
code; RLS is a second barrier that holds even when the application is wrong — including for
the allowlist gap in §2, and for anyone who reaches the database outside the app.

**Refresh tokens and short-lived access tokens.** One hour is too long. Fifteen minutes plus
a rotating refresh token, and a revocation list so logout and suspension take effect
immediately — today a suspended trader keeps a working token until it expires.

**Secrets.** `JWT_SECRET` comes from a secrets manager with rotation and a key id in the
token header, not from an env file.

---

## Appendix — the dev fill simulator

`POST /dev/fills` exists to demonstrate live updates (option 1 in
`dataset/simulate-fills.md`). Three things stop it being a production liability, in
descending order of how much I trust them:

1. **The module is not registered.** `AppModule` includes `DevModule` only when
   `NODE_ENV !== 'production' && DEV_TOOLS === 'on'`. In production the route does not
   exist — it 404s like any unknown path, because there is no handler in the route table. A
   runtime `if (isProd) throw` leaves the route mounted and one config mistake from live;
   this way the code is not in the graph at all.
2. It sits behind the same global auth guard as everything else.
3. It writes through `prisma.db` under the caller's context, so the extension stamps
   `brokerId` from the token and a cross-tenant write is refused by the same code that
   protects reads. A dev tool cannot quietly become a tenancy bypass.

The gate itself requires **two** conditions — not production, *and* `DEV_TOOLS=on` — because
a single `NODE_ENV !== 'production'` check mounts a write endpoint in every environment
where `NODE_ENV` is unset or misspelt, which is most of the ones nobody configured on
purpose. `config/env.spec.ts` tests exactly that case.

`assertProductionConfig()` runs before the process binds a port and refuses to start a
production instance that still carries the dev `JWT_SECRET`, has `DEV_TOOLS` on, or points
CORS at localhost. Booting with the shipped secret means every token that instance issues is
forgeable by anyone who has read the repository — that is a stop, not a warning.
