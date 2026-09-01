# Assessment Dataset

Seed data for the ArrowFin technical assessment. Everything here is fabricated - no real customer
data is included - but treat it as though it were production data, because that is what the
security portion of the assessment is about.

## Files

| File | Rows | Notes |
| --- | --- | --- |
| `brokers.csv` | 3 | One retail broker, two prop firms. `id` is the tenant key. |
| `traders.csv` | 14 | Contains PII. See the warning below. |
| `accounts.csv` | 18 | A trader may hold more than one account, and accounts have types and statuses. |
| `instruments.csv` | 8 | Contract specifications. Read `point_value_usd` carefully. |
| `market_prices.csv` | 8 | Marks as of the dataset cut, for unrealized P&L. |
| `fills.csv` | 687 | Executions across three trading sessions. Timestamps are UTC, ISO 8601. |

## Dataset cut

All data is as of **2026-08-25T14:30:00Z**. Treat that as "now" when you build the snapshot.

The data covers three trading sessions. Only the most recent one is "today".

## A warning worth reading twice

**The `notes` and `audit_notes` columns on `traders.csv` are not sanitized.** They contain the kind
of free text a support agent actually types: identifiers, contact details, payment information,
references to stored documents, compliance case numbers. Treat every one of those fields as real
customer data, because in production it would be.

The structured columns are regulated PII too - name, email, phone, date of birth, `ssn_last4`,
address.

## Things that are true about this data

These are not tricks. They are how trading data behaves. We mention them because ignoring them
silently produces numbers that look plausible and are wrong.

- **Contract sizes differ.** `MNQ` and `NQ` track the same index and are not the same size. Nor are
  `MES`/`ES` or `MCL`/`CL`.
- **A futures session is not a calendar day.** CME Globex opens at 17:00 US Central and runs until
  16:00 the following afternoon. One session spans two UTC dates, and one UTC date can contain the
  end of one session and the start of the next.
- **Commissions are real money** and they are per contract, per side.
- **One order can fill in several pieces.** Fills sharing an `order_id` are one order, not several.
- **Not every position is closed** by the end of a session.
- **Not every account is active**, and not every account has a balance.
- **Not every trader has traded.**

## Loading it

Up to you - `psql \copy`, a seed script, raw inserts. We do not grade the loader.
