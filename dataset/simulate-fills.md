# Simulating live fills

The snapshot widget has to update in real time. You do not need a market data feed to demonstrate
that - you just need new fills to arrive after the page has loaded.

Pick whichever of these is least work for you.

## Option 1 - an endpoint you call yourself

Add a development-only endpoint that accepts a fill and pushes it onto your WebSocket:

```
POST /dev/fills
{
  "account_id": "ACC-1006",
  "instrument_symbol": "MES",
  "side": "BUY",
  "quantity": 2,
  "price": 5643.25,
  "commission_usd": 1.40
}
```

Hit it with curl while the page is open. If the widget updates and the risk indicator moves, you
have shown what we are looking for.

**If you do this, make sure the endpoint cannot run in production.** How you guarantee that is
itself worth a sentence in your SECURITY.md.

## Option 2 - a timer on the server

On startup, emit a fill for a fixed account every few seconds from a small hard-coded list. Crude,
but it proves the socket works and it needs no tooling.

## Option 3 - replay the seed data

Load `fills.csv`, take the most recent session, sort by `filled_at` and replay with the gaps
compressed - one fill every second or two regardless of the real timestamps. Most realistic, most
work.

## What we actually care about

Not the simulator. We care that:

- the socket is authenticated and tenant-scoped **at connection time**, not per message
- a client cannot subscribe to a stream belonging to another broker
- the widget handles the socket dropping without showing stale numbers as if they were live
- whatever you push over the socket contains no more data than the client needs

A fill pushed to the wrong tenant is the single worst outcome in this exercise.
