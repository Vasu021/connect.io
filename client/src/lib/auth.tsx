import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import type { User } from './types';

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the session, so a profile change shows up everywhere at once. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // There is no token to read — the session lives in an httpOnly cookie, so the
  // only way to know who we are is to ask the server.
  useEffect(() => {
    let cancelled = false;

    api
      .get<{ user: User }>('/api/auth/me')
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch((err: unknown) => {
        // A 401 here is the normal "not signed in" case, not a failure.
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) {
          console.warn('session check failed:', err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const data = await api.post<{ user: User }>('/api/auth/login', { identifier, password });
    setUser(data.user);
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const data = await api.post<{ user: User }>('/api/auth/register', {
      username,
      email,
      password,
    });
    setUser(data.user);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>('/api/auth/me');
      setUser(data.user);
    } catch {
      // A failed refresh is not worth disturbing the page for.
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
