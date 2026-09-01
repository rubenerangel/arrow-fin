'use client';

import { pnlColor, plainUsd, price, signedUsd } from '../lib/format';
import type { Position } from '../lib/types';

export function PositionsTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 p-10 text-center">
        <p className="text-sm text-zinc-400">No activity this session</p>
        <p className="mt-1 text-xs text-zinc-600">
          Positions appear here as fills arrive. The session opens at 17:00 US Central.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
            <th className="px-4 py-3 font-medium">Instrument</th>
            <th className="px-4 py-3 text-right font-medium">Net</th>
            <th className="px-4 py-3 text-right font-medium">Avg</th>
            <th className="px-4 py-3 text-right font-medium">Mark</th>
            <th className="px-4 py-3 text-right font-medium">Unrealised</th>
            <th className="px-4 py-3 text-right font-medium">Realised</th>
            <th className="px-4 py-3 text-right font-medium">Notional</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.symbol} className="border-b border-zinc-800/60 last:border-0">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-zinc-100">{position.symbol}</span>
                  <DirectionTag direction={position.direction} />
                </div>
                <div className="mt-0.5 text-xs text-zinc-600">{position.description}</div>
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-200">
                {position.netQty > 0 ? `+${position.netQty}` : position.netQty}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-400">
                {position.netQty === 0 ? '—' : price(position.avgPrice)}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-400">
                {/* An em dash, not 0.00. A missing mark is "we do not know", and rendering it
                    as a price is how a display bug becomes a trading decision. */}
                {price(position.markPrice)}
              </td>
              <td
                className={`px-4 py-3 text-right font-mono tabular-nums ${pnlColor(position.unrealizedPnlUsd)}`}
              >
                {position.netQty === 0 ? '—' : signedUsd(position.unrealizedPnlUsd)}
              </td>
              <td
                className={`px-4 py-3 text-right font-mono tabular-nums ${pnlColor(position.realizedPnlUsd)}`}
              >
                {signedUsd(position.realizedPnlUsd)}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                {plainUsd(position.notionalUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DirectionTag({ direction }: { direction: Position['direction'] }) {
  const style =
    direction === 'LONG'
      ? 'bg-emerald-950 text-emerald-400 border-emerald-900'
      : direction === 'SHORT'
        ? 'bg-rose-950 text-rose-400 border-rose-900'
        : 'bg-zinc-800 text-zinc-500 border-zinc-700';

  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${style}`}>
      {direction}
    </span>
  );
}
