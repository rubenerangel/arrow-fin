# Code review — `GET positions/:accountId`

> Task 4. Written as I would leave it on the PR.

**Verdict: request changes.** Three blockers, all fixable in well under an hour. The shape of
the endpoint is right and the rest is detail.

---

## The one to fix first

**Any authenticated user can read any account.** `accountId` comes off the path and goes
straight into the `where` with no ownership or tenant check, so
`GET /positions/ACC-1006` returns Summit's book to a Meridian trader. Given we're a
regulated entity on shared infrastructure, this is a P0 and a reportable one if it ships.

You already reached for `req` and didn't use it — I think you knew this was coming and got
pulled away. Minimum fix:

```ts
const account = await this.prisma.account.findFirst({
  where: { id: accountId, brokerId: req.user.brokerId, traderId: req.user.traderId },
  select: { id: true },
});
if (!account) throw new NotFoundException();
```

`NotFoundException`, not `Forbidden` — a 403 confirms the account exists, which hands an
attacker an account enumeration oracle for free.

Worth a five-minute conversation before you write it, though: **does this route need
`:accountId` at all?** If the caller can only ever see their own accounts, take the subject
from the token and drop the param, and the bug class disappears rather than getting a guard
we have to remember on the next endpoint too. If it genuinely needs to address one account
of several, keep the param and the check above is correct. Happy to pair on it either way.

## Also blocking

**We're dumping account data into the logs.**

```ts
this.logger.log(`positions for ${accountId}: ${JSON.stringify(positions)}`);
```

Two separate problems in one line.

`JSON.stringify(positions)` puts a customer's financial position into a log aggregator with
different retention and a much wider access list than the database it came from. That's the
PII/compliance boundary, and once it's in the log pipeline we can't get it back.

And `accountId` is interpolated unescaped — a newline in that value forges log lines. It's
niche until it's the thing that made an intrusion look like a routine 200 in whatever the
SOC was reading.

If you want the observability, log ids and a count: `positions for ${accountId}: n=${positions.length}`,
with the id validated. Better still, a metric.

**The P&L is wrong for anything that isn't a full-size contract.**

```ts
pnl: (p.markPrice - p.avgPrice) * p.qty
```

This is points, not dollars. MNQ and NQ both quote around 19,845 and are $2 and $20 a point,
so this number is 10x off for one of them and looks completely plausible either way. Same for
MES/ES and MCL/CL. Needs `* instrument.pointValueUsd`.

Second-order: if `markPrice`/`avgPrice` are Prisma `Decimal`, `-` coerces them through
`valueOf()` and you get float arithmetic on money. It'll be right to eleven digits and wrong
at the twelfth, which is the kind of thing that shows up as a one-cent reconciliation break
six months from now. `.minus()` and keep it Decimal to the serialisation boundary.

## Non-blocking, worth doing

- **`...p` spreads the whole row to the client.** Today that's probably fine; the failure
  mode is that someone adds a column to `positions` and it's on the wire that afternoon with
  no diff that looks like a disclosure. An explicit DTO makes every exposed field a decision
  someone typed.
- **The calculation lives in the controller.** Move it to a service or a pure function and
  the point-value bug above becomes a two-line unit test instead of a manual check.
- **Unbounded `findMany`.** Fine for open positions, not fine the day someone points this at
  fills. Worth a limit before it's load-bearing.

## Style, take it or leave it

- `@Req() req` is implicitly `any` — types it, or use a `@CurrentUser()` decorator if we
  have one.
- Explicit return type on the handler.

---

**Summary for whoever picks this up:** the ownership check is the one that must not ship
without a fix. The log line is the one I'd want done in the same PR because it's two minutes.
The P&L is a real bug but it's a wrong number, not a data breach, so I'd take it in a
follow-up if you're blocked on something. Everything under "style" is genuinely optional and
I'd approve with those outstanding.
