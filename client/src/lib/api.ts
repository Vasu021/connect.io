// FIX #5 — Use env var so the URL works in non-local deployments.
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function getToken(): string | null {
  return localStorage.getItem('connect_token');
}

export function setToken(token: string): void {
  localStorage.setItem('connect_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('connect_token');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(typeof data.message === 'string' ? data.message : 'Request failed');
  }

  return data as T;
}

export { API_BASE };
