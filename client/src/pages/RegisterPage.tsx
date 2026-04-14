import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import { api } from '../lib/api';
import { User } from '../types';

type Props = {
  onAuth: (token: string, user: User) => void;
};

type RegisterResponse = {
  token: string;
  user: User;
};

export default function RegisterPage({ onAuth }: Props) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api<RegisterResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onAuth(data.token, data.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Create account" subtitle="Start discovering how you connect.">
      <form onSubmit={handleSubmit} className="stack">
        <input
          placeholder="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <input
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          type="password"
          placeholder="Password (min 8 chars)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {error ? <div className="error">{error}</div> : null}
        <button className="primary-btn" disabled={loading}>
          {loading ? 'Creating...' : 'Register'}
        </button>
      </form>
      <div className="auth-link">
        Already have an account? <Link to="/login">Login</Link>
      </div>
    </AuthCard>
  );
}
