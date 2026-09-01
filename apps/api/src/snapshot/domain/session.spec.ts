import { sessionStart } from './session';

/**
 * Protects invariant 6 (time is injected) and the session-boundary rule.
 *
 * The bug this exists to prevent: treating a UTC calendar day as a trading session. It
 * does not throw, it does not look wrong, it just quietly reports the wrong day's P&L.
 */
describe('sessionStart', () => {
  it('places the dataset cut inside the session that opened the previous evening', () => {
    // 2026-08-25T14:30:00Z is 09:30 CDT - mid-session, not a new one.
    const start = sessionStart(new Date('2026-08-25T14:30:00Z'));
    expect(start.toISOString()).toBe('2026-08-24T22:00:00.000Z');
  });

  it('draws the boundary at 17:00 CT, not at midnight UTC', () => {
    // One second before the open still belongs to the session that is about to end.
    expect(sessionStart(new Date('2026-08-24T21:59:59Z')).toISOString()).toBe(
      '2026-08-23T22:00:00.000Z',
    );
    // The open itself starts the new session.
    expect(sessionStart(new Date('2026-08-24T22:00:00Z')).toISOString()).toBe(
      '2026-08-24T22:00:00.000Z',
    );
  });

  it('keeps one UTC date split across two sessions', () => {
    // 2026-08-25 contains the tail of the session that opened on the 24th and, from
    // 22:00Z, the head of the next one. Same calendar date, two different sessions.
    const morning = sessionStart(new Date('2026-08-25T10:00:00Z'));
    const evening = sessionStart(new Date('2026-08-25T23:00:00Z'));
    expect(morning.toISOString()).toBe('2026-08-24T22:00:00.000Z');
    expect(evening.toISOString()).toBe('2026-08-25T22:00:00.000Z');
    expect(morning).not.toEqual(evening);
  });

  it('follows the Chicago DST offset rather than a hardcoded one', () => {
    // January is CST (UTC-6), so the same 17:00 local open lands at 23:00Z.
    expect(sessionStart(new Date('2026-01-15T14:30:00Z')).toISOString()).toBe(
      '2026-01-14T23:00:00.000Z',
    );
    // August is CDT (UTC-5) and lands at 22:00Z. A fixed -6 would be an hour out for
    // eight months of the year.
    expect(sessionStart(new Date('2026-08-15T14:30:00Z')).toISOString()).toBe(
      '2026-08-14T22:00:00.000Z',
    );
  });

  it('is a pure function of its argument', () => {
    const now = new Date('2026-08-25T14:30:00Z');
    expect(sessionStart(now)).toEqual(sessionStart(now));
    // And it does not mutate what it is given.
    expect(now.toISOString()).toBe('2026-08-25T14:30:00.000Z');
  });
});
