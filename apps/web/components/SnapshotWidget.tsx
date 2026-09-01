'use client';

import { pnlColor, plainUsd, signedUsd, timeOfDay } from '../lib/format';
import type { ConnectionState, FillEvent, Snapshot } from '../lib/types';
import { ConnectionBadge } from './ConnectionBadge';
import { PositionsTable } from './PositionsTable';
import { RiskGauge } from './RiskGauge';

interface Props {
  snapshot: Snapshot;
  connection: ConnectionState;
  missedFills: boolean;
  lastFill: FillEvent | null;
}

export function SnapshotWidget({ snapshot, connection, missedFills, lastFill }: Props) {
  const stale = connection === 'stale';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Daily snapshot</h1>
          <p className="mt-0.5 font-mono text-xs text-zinc-500">
            Session opened {timeOfDay(snapshot.sessionStart)} UTC · as of{' '}
            {timeOfDay(snapshot.asOf)} UTC
          </p>
        </div>
        <ConnectionBadge state={connection} missedFills={missedFills} />
      </header>

      {/*
        Dimming the whole figure block while stale is the point of the badge. A greyed-out
        number reads as "not current" even to someone who never looks at the badge; a crisp
        one that happens to be forty minutes old does not.
      */}
      <div className={stale ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Day P&L" value={signedUsd(snapshot.totals.dayPnlUsd)} tone={pnlColor(snapshot.totals.dayPnlUsd)} big />
          <div className="grid grid-cols-2 gap-4 md:col-span-1">
            <Stat label="Realised" value={signedUsd(snapshot.totals.realizedPnlUsd)} tone={pnlColor(snapshot.totals.realizedPnlUsd)} />
            <Stat label="Unrealised" value={signedUsd(snapshot.totals.unrealizedPnlUsd)} tone={pnlColor(snapshot.totals.unrealizedPnlUsd)} />
            <Stat label="Commissions" value={`-${plainUsd(snapshot.totals.commissionsUsd)}`} tone="text-zinc-400" />
            <Stat label="Gross notional" value={plainUsd(snapshot.totals.grossNotionalUsd)} tone="text-zinc-300" />
          </div>
          <RiskGauge risk={snapshot.risk} />
        </div>

        <div className="mt-6">
          <PositionsTable positions={snapshot.positions} />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
        <span>
          {snapshot.accounts.map((a) => `${a.maskedNumber} (${a.accountType})`).join(' · ') ||
            'No tradable accounts'}
          {snapshot.meta.accountsExcluded > 0 &&
            ` · ${snapshot.meta.accountsExcluded} closed account excluded`}
        </span>
        {lastFill && (
          <span className="font-mono text-emerald-500">
            last fill {lastFill.side} {lastFill.quantity} {lastFill.symbol} @ {lastFill.price}
          </span>
        )}
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  big = false,
}: {
  label: string;
  value: string;
  tone: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs font-medium uppercase tracking-widest text-zinc-500">{label}</div>
      <div
        className={`mt-2 font-mono tabular-nums ${tone} ${big ? 'text-4xl font-semibold' : 'text-lg'}`}
      >
        {value}
      </div>
    </div>
  );
}
