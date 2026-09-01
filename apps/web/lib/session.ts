'use client';

/**
 * Where the access token lives on the client.
 *
 * It is in memory plus sessionStorage, which is a deliberate compromise for an assessment
 * and not what I would ship. The real answer is an httpOnly, Secure, SameSite=Strict cookie
 * set by a Next route handler, so the token is unreadable from JavaScript and an XSS becomes
 * "can make requests as the user while the page is open" rather than "has the credential".
 *
 * The reason it is not that here: the WebSocket handshake needs the token in the `auth`
 * payload, so the browser has to be able to read it. Doing it properly means a server-side
 * proxy or a short-lived socket ticket minted by a route handler - a good half hour I spent
 * on the tenant isolation instead. Called out in SECURITY.md rather than left to be found.
 */

const KEY = 'arrowfin.token';

export function saveToken(token: string): void {
  sessionStorage.setItem(KEY, token);
}

export function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(KEY);
}

export function clearToken(): void {
  sessionStorage.removeItem(KEY);
}

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
