import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import DashboardPage from './pages/DashboardPage';
import GamePage from './pages/GamePage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import ProfilePage from './pages/ProfilePage';
import RoomPage from './pages/RoomPage';
import RegisterPage from './pages/RegisterPage';
import type { ReactElement } from 'react';

function Protected({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function GuestOnly({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function Booting() {
  return (
    <div className="center-screen">
      <div className="stack" style={{ alignItems: 'center', gap: 14 }}>
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </span>
        <span className="muted small">Opening connect.io…</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnly>
            <RegisterPage />
          </GuestOnly>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route
        path="/room/:roomId"
        element={
          <Protected>
            <RoomPage />
          </Protected>
        }
      />
      <Route
        path="/game/:gameId"
        element={
          <Protected>
            <GamePage />
          </Protected>
        }
      />
      <Route
        path="/history"
        element={
          <Protected>
            <HistoryPage />
          </Protected>
        }
      />
      <Route
        path="/player/:userId"
        element={
          <Protected>
            <ProfilePage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
