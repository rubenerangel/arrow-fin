/** Display helpers. Trading UIs are read at a glance, so signs and alignment matter. */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Always shows the sign on P&L - "+120.50" and "-120.50" scan differently from "120.50". */
export function signedUsd(value: number): string {
  const formatted = usd.format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function plainUsd(value: number): string {
  return usd.format(value);
}

export function price(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** Green up, red down, neutral at zero. Zero is not green. */
export function pnlColor(value: number): string {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-rose-400';
  return 'text-zinc-400';
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}
