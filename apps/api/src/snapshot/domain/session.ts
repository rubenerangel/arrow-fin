/**
 * A futures session is not a calendar day.
 *
 * CME Globex opens at 17:00 US Central and runs to 16:00 the following afternoon. That
 * means one session spans two UTC dates, and one UTC date contains the tail of one session
 * and the head of the next. Bucketing fills with `filled_at::date = today` is the mistake
 * that produces numbers which look plausible and are wrong: against this dataset it
 * returns 160 fills where the real session has 168.
 *
 * Pure function, no Date.now() - "now" is always passed in. That is what makes the whole
 * snapshot deterministic against a frozen dataset.
 */

const CHICAGO = 'America/Chicago';
const SESSION_OPEN_HOUR_CT = 17;

/** Wall-clock fields of `instant` as observed in America/Chicago. */
function chicagoParts(instant: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = read('hour') % 24;
  return { year: read('year'), month: read('month'), day: read('day'), hour };
}

/** UTC offset of America/Chicago at `instant`, in minutes (CST -360, CDT -300). */
function chicagoOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

/**
 * The instant the session containing `now` opened.
 *
 * Before 17:00 CT we are still inside the session that opened at 17:00 the previous day;
 * at or after 17:00 CT a new session has begun.
 *
 * For the dataset cut 2026-08-25T14:30:00Z (09:30 CDT) this returns
 * 2026-08-24T22:00:00Z, which is 17:00 CDT on the 24th.
 */
export function sessionStart(now: Date): Date {
  const { year, month, day, hour } = chicagoParts(now);

  // Candidate open, expressed as if Chicago wall-clock were UTC, then shifted by the
  // offset in force at that moment. Computing the offset from a probe near the candidate
  // rather than from `now` keeps the DST transition days honest.
  const probe = new Date(Date.UTC(year, month - 1, day, SESSION_OPEN_HOUR_CT) + 6 * 3_600_000);
  const offsetMinutes = chicagoOffsetMinutes(probe);

  const openOnThisDate = Date.UTC(year, month - 1, day, SESSION_OPEN_HOUR_CT) - offsetMinutes * 60_000;
  const dayShift = hour >= SESSION_OPEN_HOUR_CT ? 0 : 24 * 3_600_000;

  return new Date(openOnThisDate - dayShift);
}

/** The session window [start, now] used for every "today" figure in the snapshot. */
export function sessionWindow(now: Date): { start: Date; now: Date } {
  return { start: sessionStart(now), now };
}
