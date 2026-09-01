'use client';

import type { ConnectionState } from '../lib/types';

/**
 * The honesty indicator.
 *
 * When the feed drops, the numbers on screen are a photograph, not a live view, and they
 * look identical either way. This is the only thing telling the trader which one they are
 * looking at - so when it says STALE the figures are dimmed as well, in SnapshotPage.
 */
export function ConnectionBadge({ state, missedFills }: { state: ConnectionState; missedFills: boolean }) {
  if (state === 'live') {
    return (
      <Badge className="border-emerald-800 bg-emerald-950/60 text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Live
      </Badge>
    );
  }

  if (state === 'connecting') {
    return (
      <Badge className="border-zinc-700 bg-zinc-900 text-zinc-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
        Connecting
      </Badge>
    );
  }

  return (
    <Badge className="border-amber-700 bg-amber-950/50 text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {missedFills ? 'Stale — resyncing' : 'Stale — not live'}
    </Badge>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}
