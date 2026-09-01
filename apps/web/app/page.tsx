'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { SnapshotWidget } from '../components/SnapshotWidget';
import { useSnapshotStream, SNAPSHOT_KEY } from '../hooks/useSnapshotStream';
import { login } from '../lib/api';
import { clearToken, readToken, saveToken } from '../lib/session';

/**
 * The whole widget. One page, four states: signed out, loading, error, and the snapshot -
 * with "disconnected" layered on top of the last of those rather than replacing it.
 */
export default function Page() {
  const [authed, setAuthed] = useState(() => readToken() !== null);
  const { snapshot, isLoading, error, refetch, connection, lastFill, missedFills } =
    useSnapshotStream(authed);

  if (!authed) return <SignIn onSignedIn={() => setAuthed(true)} />;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {isLoading && <Skeleton />}

      {error && !isLoading && (
        <ErrorState
          message={
            error.name === 'UnauthorizedError'
              ? 'Your session expired. Sign in again.'
              : error.message
          }
          onRetry={() => {
            if (error.name === 'UnauthorizedError') {
              clearToken();
              setAuthed(false);
            } else {
              void refetch();
            }
          }}
        />
      )}

      {snapshot && !error && (
        <SnapshotWidget
          snapshot={snapshot}
          connection={connection}
          missedFills={missedFills}
          lastFill={lastFill}
        />
      )}
    </main>
  );
}

/**
 * Dev sign-in against the seeded traders. Email only - there are no passwords in the
 * dataset, and the API says so too. Two tenants are offered so the isolation is easy to
 * check by hand: sign in as each and confirm neither sees the other's book.
 */
function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('h.whitfield@meridianfg.example');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      const result = await login(email);
      saveToken(result.accessToken);
      // Drop anything cached for the previous identity before the next one renders.
      queryClient.removeQueries({ queryKey: SNAPSHOT_KEY });
      onSignedIn();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-lg font-semibold text-zinc-100">ArrowFin</h1>
      <p className="mt-1 text-sm text-zinc-500">Trader daily snapshot</p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-600"
          placeholder="trader email"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {failed && <p className="text-sm text-rose-400">Invalid credentials</p>}
      </form>

      <div className="mt-8 space-y-1 text-xs text-zinc-600">
        <p className="text-zinc-500">Seeded traders — try one from each tenant:</p>
        {[
          ['h.whitfield@meridianfg.example', 'Meridian · open MCL position'],
          ['elena.vasquez@summitprop.example', 'Summit · different tenant'],
          ['d.ferrer@meridianfg.example', 'Meridian · zero-balance account'],
          ['a.karim@meridianfg.example', 'Meridian · no fills this session'],
        ].map(([address, note]) => (
          <button
            key={address}
            onClick={() => setEmail(address)}
            className="block text-left font-mono hover:text-zinc-400"
          >
            {address} <span className="font-sans text-zinc-700">— {note}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-6 w-48 rounded bg-zinc-900" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-28 rounded-lg bg-zinc-900" />
        <div className="h-28 rounded-lg bg-zinc-900" />
        <div className="h-28 rounded-lg bg-zinc-900" />
      </div>
      <div className="h-48 rounded-lg bg-zinc-900" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-900 bg-rose-950/30 p-6">
      <p className="text-sm font-medium text-rose-300">Could not load the snapshot</p>
      <p className="mt-1 text-sm text-zinc-400">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900"
      >
        Try again
      </button>
    </div>
  );
}
