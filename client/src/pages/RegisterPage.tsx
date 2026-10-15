import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const passwordShort = password.length > 0 && password.length < 10;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError('');

    try {
      await register(username, email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <Brand to="/register" />
        <h1 style={{ fontSize: 26, marginTop: 18 }}>Create your account</h1>
        <p className="auth-tagline">
          Two players, one word each, fifteen seconds. Lower score, closer minds.
        </p>

        <form className="stack" onSubmit={onSubmit} noValidate>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3–20 letters, numbers or _"
            />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label htmlFor="new-password">Password</label>
            <input
              id="new-password"
              className={`input${passwordShort ? ' input-error' : ''}`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 10 characters"
            />
            <span className="small faint">
              {passwordShort ? `${10 - password.length} more characters needed` : 'At least 10 characters'}
            </span>
          </div>

          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already playing? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
