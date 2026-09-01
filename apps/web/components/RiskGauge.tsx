'use client';

import type { Snapshot } from '../lib/types';

/**
 * "A >75 risk score should be visually unmissable."
 *
 * Colour alone is not unmissable - it fails for a colourblind trader and it fails on a
 * monitor across the desk. Above the threshold this changes size, weight, border, background
 * and adds a word ("HIGH RISK"), so it survives being seen in peripheral vision, in
 * greyscale, and by someone who is looking at a different window.
 */
export function RiskGauge({ risk }: { risk: Snapshot['risk'] }) {
  const isHigh = risk.band === 'HIGH';

  const bar =
    risk.band === 'HIGH' ? 'bg-rose-500' : risk.band === 'ELEVATED' ? 'bg-amber-400' : 'bg-emerald-500';

  return (
    <div
      className={[
        'rounded-lg border p-5 transition-colors',
        isHigh
          ? 'border-rose-500 bg-rose-950/40 ring-2 ring-rose-500/60'
          : 'border-zinc-800 bg-zinc-900/60',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Risk indicator
        </span>
        {isHigh && (
          <span className="animate-pulse rounded bg-rose-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
            High risk
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span
          className={[
            'font-mono tabular-nums leading-none',
            isHigh ? 'text-6xl font-bold text-rose-300' : 'text-4xl font-semibold text-zinc-100',
          ].join(' ')}
        >
          {risk.score.toFixed(2)}
        </span>
        <span className="pb-1 text-sm text-zinc-500">/ 100</span>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full ${bar} transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(2, risk.score))}%` }}
        />
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        {/* An explanation, because a 100 that means "you have no equity" is a different
            problem from a 100 that means "you are heavily levered". */}
        {risk.reason === 'NO_BALANCE'
          ? 'Open exposure with no account equity — treated as maximum risk.'
          : risk.reason === 'NO_EXPOSURE'
            ? 'No open exposure this session.'
            : `Gross notional as a percentage of balance. High above ${risk.threshold}.`}
      </p>
    </div>
  );
}
