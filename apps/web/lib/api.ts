'use client';

import { API_BASE, readToken } from './session';
import type { Snapshot } from './types';

export class UnauthorizedError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'UnauthorizedError';
  }
}

export async function login(email: string): Promise<{ accessToken: string; trader: { displayName: string } }> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    // The API returns the same 401 for unknown email and suspended account. Repeating that
    // ambiguity here keeps the UI from becoming the enumeration oracle the API refused to be.
    throw new Error('Invalid credentials');
  }
  return response.json();
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const token = readToken();
  if (!token) throw new UnauthorizedError();

  const response = await fetch(`${API_BASE}/api/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);

  return response.json();
}
