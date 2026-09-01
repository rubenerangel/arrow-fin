'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';

import { fetchSnapshot } from '../lib/api';
import { API_BASE, readToken } from '../lib/session';
import type { ConnectionState, FillEvent, Snapshot } from '../lib/types';

export const SNAPSHOT_KEY = ['snapshot'] as const;

/**
 * Initial load over REST, live updates over the socket, one cache entry.
 *
 * The socket pushes a recomputed snapshot rather than a delta the client has to apply. That
 * is a deliberate trade: more bytes per event, but the client never maintains its own copy
 * of the position maths, so it cannot drift from the server. Two implementations of
 * weighted-average cost that disagree is a bug you find in production, from a screenshot.
 */
export function useSnapshotStream(enabled: boolean) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastFill, setLastFill] = useState<FillEvent | null>(null);
  const seenSeq = useRef(0);
  const [missedFills, setMissedFills] = useState(false);

  const query = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: fetchSnapshot,
    enabled,
    retry: (count, error) => error.name !== 'UnauthorizedError' && count < 2,
  });

  useEffect(() => {
    if (!enabled) return;
    const token = readToken();
    if (!token) return;

    // Token goes in the handshake `auth` payload, never the query string - a bearer token in
    // a proxy access log is a credential at rest.
    const socket: Socket = io(`${API_BASE}/rt`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => setConnection('live'));

    socket.on('connected', ({ seq }: { seq: number }) => {
      // The server's high-water mark. If it is ahead of what we have seen, fills landed
      // while we were gone. We do not try to replay them - the REST snapshot is the source
      // of truth and already contains them.
      if (seq > seenSeq.current && seenSeq.current > 0) {
        setMissedFills(true);
        void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      }
      seenSeq.current = seq;
    });

    socket.on('snapshot', ({ seq, snapshot }: { seq: number; snapshot: Snapshot }) => {
      seenSeq.current = seq;
      setMissedFills(false);
      queryClient.setQueryData(SNAPSHOT_KEY, snapshot);
    });

    socket.on('fill', (fill: FillEvent) => setLastFill(fill));

    // Every path that ends the connection marks the data stale. Showing a risk score of 42
    // that is actually 96, with no visual difference from a live one, is the failure mode
    // this whole hook exists to avoid.
    socket.on('disconnect', () => setConnection('stale'));
    socket.on('connect_error', () => setConnection('stale'));
    socket.on('unauthorized', () => {
      setConnection('stale');
      socket.disconnect();
    });

    // Real cleanup. Without it React 18 Strict Mode leaves an orphaned socket per mount and
    // events arrive twice in development, which is exactly the kind of thing that gets
    // "fixed" by disabling Strict Mode.
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [enabled, queryClient]);

  return {
    snapshot: query.data,
    isLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    connection,
    lastFill,
    /** True when we know we missed events and the refetch has not landed yet. */
    missedFills,
  };
}
