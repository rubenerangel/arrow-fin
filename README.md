# ArrowFin — Trader Daily Snapshot

Technical assessment submission. Backend is complete and verified end to end; the frontend
widget is the part I cut, and the reasoning is in "What I cut and why" below.

**Time taken:** <!-- RELLENAR: horas reales --> (budget was 2–3 hours)

**LLM use:** disclosed in full in [LLM use](#llm-use) below. Short version: I used Claude
Code throughout, and the parts I would have written differently by hand are named there.

---

## Background

<!--
  RELLENAR — esta sección tiene que ser tuya, palabra por palabra.
  El enunciado dice literalmente: "We'd rather hire a self-aware 2 than an exaggerating 4."
  Un 5 inflado se cae en la entrevista en dos preguntas; un 2 honesto no.
  Escala: 1 nunca usado · 2 nivel tutorial · 3 he shippeado código · 4 cómodo en producción · 5 podría enseñarlo.
-->

**Stack ratings**

- TypeScript — _n_
- Next.js — _n_
- NestJS — _n_
- Prisma — _n_
- PostgreSQL — _n_
- WebSockets — _n_
- Tailwind — _n_
- JWT / auth — _n_
- Multi-tenant data isolation — _n_
- <!-- añade lo que quieras: Laravel, Docker, React Query, testing, CI... -->

**Five short answers**

1. *What part of our stack are you strongest with?* —
2. *What would be the steepest learning curve?* —
3. *Any tech not in your stack you consider a core strength?* —
4. *What kind of work do you most want to do day-to-day?* —
5. *What do you most want to avoid?* —

---

## What's here

| | |
| --- | --- |
| **Task 1** — backend snapshot service | Done, verified against the seeded dataset |
| **Task 2** — frontend widget | **Cut.** See below |
| **Task 3** — security & PII | [`SECURITY.md`](SECURITY.md) |
| **Task 4** — code review | [`CODE_REVIEW.md`](CODE_REVIEW.md) |
| **Task 5** — architecture & handoff | Below |
| Architecture & invariants | [`CLAUDE.md`](CLAUDE.md) |

## Running it

```bash
docker compose up -d                        # postgres 16 on 5435
cd apps/api
cp .env.example .env
npm install
npm run prisma:generate && npm run prisma:push
npm run seed                                # 3 brokers, 14 traders, 18 accounts, 687 fills
npm test                                    # 52 tests, no database required
npm run build && node dist/main.js
```

```bash
TOKEN=$(curl -s localhost:3001/auth/login -H 'content-type: application/json' \
  -d '{"email":"h.whitfield@meridianfg.example"}' | jq -r .accessToken)

curl -s localhost:3001/api/snapshot -H "Authorization: Bearer $TOKEN" | jq
```

Real output for T-009 at the dataset cut:

```json
{
  "asOf": "2026-08-25T14:30:00.000Z",
  "sessionStart": "2026-08-24T22:00:00.000Z",
  "positions": [
    { "symbol": "MCL", "netQty": 6, "direction": "LONG", "avgPrice": 73.95,
      "markPrice": 74.18, "unrealizedPnlUsd": 138, "realizedPnlUsd": -4.2 },
    { "symbol": "MES", "netQty": 0, "direction": "FLAT", "realizedPnlUsd": 98.5 }
  ],
  "totals": { "dayPnlUsd": 232.3, "commissionsUsd": 18.2, "grossNotionalUsd": 44508 },
  "risk": { "score": 44.51, "band": "ELEVATED", "reason": "OK", "threshold": 75 },
  "accounts": [{ "id": "ACC-1011", "maskedNumber": "MRD-***001", "balanceUsd": 100000 }],
  "meta": { "fillsConsidered": 4, "accountsIncluded": 1, "accountsExcluded": 1 }
}
```

`sessionStart` is 22:00Z on the **24th**, not midnight on the 25th. `accountsExcluded: 1` is
the closed eval account. No PII in the payload and the account number is masked.

## What the dataset punished

Things I got wrong first, or would have:

- **A futures session is not a calendar day.** Globex opens 17:00 US Central. Filtering
  `filled_at::date = '2026-08-25'` gives 160 fills; the actual session has 168. Both look
  fine on screen.
- **`point_value_usd` differs between the micro and the full contract.** MNQ and NQ track the
  same index at $2 and $20 a point. Any P&L written as `(mark - avg) * qty` is 10x wrong for
  one of them.
- **ACC-1013 has `balance = 0.00` and open fills.** The given risk formula divides by that.
  `Infinity` serialises to `null` and blanks the badge on the most exposed account in the
  book, so zero balance with exposure is treated as maximum risk with an explicit reason.
- **Not every account should count.** ACC-1012 is `closed` — excluded. ACC-1010 is
  `restricted` — included, because the trader can't open new risk there but the existing
  exposure is live, and hiding it is backwards for a risk widget.
- **One order fills in pieces.** ORD-900185 arrives as two fills a second apart; netting has
  to see one 10-lot position.

## Reconnect behaviour

*(Task 2 asks for the approach in writing, not an implementation.)*

Every socket event carries a monotonic `seq` per trader stream, and `handleConnection` sends
the current high-water mark on connect. The client keeps the last `seq` it saw.

**On reconnect, if the server's `seq` is higher than the client's, fills were missed.** The
client does not try to replay them — it refetches `GET /api/snapshot`, which is the source
of truth and already reflects everything that happened. Rebuilding state from a partial
event stream is how you end up with a position that drifts from the server's.

**While disconnected the UI must not present stale numbers as live.** The intended
treatment: a `STALE` badge, figures dimmed, and the "as of" timestamp switched to the last
confirmed update. The dangerous state is not "no data", it's a risk score of 42 that is
actually 96 and looks exactly as authoritative as it did a minute ago.

**Implemented:** `seq` on the wire, the high-water mark on connect.
**Not implemented:** the server-side replay buffer, and — since the widget was cut — the
client half. If you connected a naive client to this socket today it *would* show stale
numbers on a drop, and that's the honest answer.

## What I cut and why

**The frontend widget.** With two hours, the assessment weights are 25% security, 20%
backend, 20% frontend, 20% communication, 15% code review — 60% of the grade is judgment
expressed in writing. A half-built widget would have cost the security writeup, the code
review, or the tests, and traded a stronger score for a weaker one.

What I'd build first if this continued, in order: the snapshot card with the >75 risk state
unmissable (full red border, not a coloured number — it needs to be visible from across a
desk), then loading/error/empty/**disconnected** states, then the socket hook with a real
`useEffect` cleanup, then polish.

**Also cut, deliberately:** Prisma migrations (`db push` instead), password auth (there are
no passwords in the dataset and a fake hash column would be theatre), and the production
hardening enumerated in [`SECURITY.md` §5](SECURITY.md).

## LLM use

I used **Claude Code (Opus)** for the whole build, as an agent rather than as autocomplete.
Specifically:

- **Generated and kept largely as-is:** project scaffolding, `docker-compose.yml`, the CSV
  parser and seed script, the Prisma schema mechanics, and the repository adapters. Boring,
  verifiable code.
- **Generated from decisions I made:** the tenant extension, the endpoint shape, the domain
  split, and the test cases. The design calls — enforce isolation in the data layer, no
  subject id in the route, `now` injected, fail-closed — were mine; the typing was not.
- **My own analysis, before any code:** reading the dataset for the traps above. The session
  boundary, the point-value difference and the zero-balance account came out of inspecting
  the CSVs, and they're what the design is built around.
- **Written with me, argued sentence by sentence:** `SECURITY.md` and `CODE_REVIEW.md`.

**What I'd change if I'd written it by hand:** `session.ts` does timezone arithmetic with
`Intl.DateTimeFormat` to avoid a dependency, and it's more code than the problem deserves —
I'd take the `date-fns-tz` dependency and delete forty lines. I'd also have written fewer,
denser tests; the LLM's instinct is to enumerate cases, and I'd have leaned harder on the
tenant-isolation and point-value ones and dropped a couple of the others.

**What I verified rather than trusted:** every number in this README came from the running
service against the seeded database, not from the model. The endpoint output above is real.
Two of the tests it wrote failed on first run — one from a band-boundary rounding assumption,
one because a PII test greped for `"ssn"` and `grossNotionalUsd` contains it. That second one
is instructive: it would have passed review and then failed noisily later. I replaced it with
an assertion on the exact emitted key set plus the fixture's real PII values.

---

## Task 5 — Architecture & handoff

**The decision I'm most proud of, and what it cost.** Tenant isolation lives in the data
layer, not in each query. A Prisma client extension injects `broker_id` on every operation
against a tenant-owned model, and throws when there's no principal instead of returning
everything. So the answer to "what if someone forgets the `WHERE`" is that they can't express
the query. `PrismaAccountRepository.findByTrader` has no tenant clause on purpose — adding
one would make the isolation test pass for the wrong reason. **The cost is implicit
behaviour**, and I don't want to undersell it: a query does something the code doesn't show,
which is exactly the kind of magic that bites a new joiner at 2am. I paid for it with the
docs, an allowlist that's a single visible constant, and tests that assert the mechanism
rather than the outcome — and it earned its keep during the build, when login failed closed
because a lazy Prisma promise escaped its async context. It caught its own author on day one.

**The one thing I'd change with a second day.** Postgres RLS underneath the extension.
Everything above is application code, and application code is wrong sometimes — the honest
gap is `TENANT_SCOPED_MODELS`: add a table with customer data, forget the allowlist, and it's
unprotected. An RLS policy holds even when the app is wrong, and it covers anything that
reaches the database outside the app. Second, the socket replay buffer, so a reconnecting
client can be told what it missed rather than being told to start over.

**Handing this to two engineers tomorrow.** First thing I'd say: read `CLAUDE.md`, then
`SECURITY.md`, then pick a test and follow it back into the code — the tests are written to
explain why each rule exists, not just to pass. Then I'd tell them what this dataset punishes,
because it's not guessable: a session isn't a calendar day, MNQ isn't NQ, and one account has
a zero balance that will divide.

What I'd *want* them changing on day one: the domain functions, the DTO shape, anything in
the frontend. That's the point of the pure-function boundary — it's safe to be wrong in there,
and the tests are fast.

What I would not let them change without me in the room, and I'd say it as plainly as this:
**the tenant extension, and the absence of a subject id in the route signature.** Not because
they're sacred, but because both look like friction from the inside. The extension looks like
a query filter that's already handled elsewhere; the route looks like it's missing an obvious
`:traderId` that support tooling clearly needs. Both "improvements" are a P0 cross-tenant
leak. If someone needs an admin view, we build a separate, separately-authorized endpoint —
we don't widen this one. That's not a code style I'm defending, it's the one bug in this
system that gets us a regulatory report, and I'd rather be annoying about it once than
explain it to compliance later.
