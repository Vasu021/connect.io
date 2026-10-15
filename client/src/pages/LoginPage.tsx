import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError('');

    try {
      await login(identifier, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <Brand to="/login" />
        <h1 style={{ fontSize: 26, marginTop: 18 }}>Welcome back</h1>
        <p className="auth-tagline">Find out how well you and a friend really think alike.</p>

        <form className="stack" onSubmit={onSubmit} noValidate>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="identifier">Username or email</label>
            <input
              id="identifier"
              className="input"
              autoComplete="username"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="vasu"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
            />
          </div>

          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
