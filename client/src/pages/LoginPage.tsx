import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import { api } from '../lib/api';
import { User } from '../types';

type Props = {
  onAuth: (token: string, user: User) => void;
};

type LoginResponse = {
  token: string;
  user: User;
};

export default function LoginPage({ onAuth }: Props) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onAuth(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Log in to keep connecting.">
      <form onSubmit={handleSubmit} className="stack">
        <input
          placeholder="Username or email"
          value={form.identifier}
          onChange={(e) => setForm({ ...form, identifier: e.target.value })}
        />
        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {error ? <div className="error">{error}</div> : null}
        <button className="primary-btn" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
      <div className="auth-link">
        New here? <Link to="/register">Create an account</Link>
      </div>
    </AuthCard>
  );
}
