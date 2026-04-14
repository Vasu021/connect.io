import { ReactNode, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, clearToken, getToken, setToken } from "./lib/api";
import DashboardPage from "./pages/DashboardPage";
import GamePage from "./pages/GamePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import { User } from "./types";

type ProtectedRouteProps = {
  user: User | null;
  children: ReactNode;
};

type MeResponse = {
  user: User;
};

function ProtectedRoute({ user, children }: ProtectedRouteProps) {
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [bootLoading, setBootLoading] = useState(true);

  useEffect(() => {
    async function loadMe() {
      if (!getToken()) {
        setUser(null);
        setBootLoading(false);
        return;
      }

      try {
        const data = await api<MeResponse>("/api/auth/me");
        setUser(data.user);
      } catch {
        clearToken();
        setUser(null);
      } finally {
        setBootLoading(false);
      }
    }

    void loadMe();
  }, []);

  if (bootLoading) {
    return <div className="center-screen">Loading connect.io...</div>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage
              onAuth={(token, nextUser) => {
                setToken(token);
                setUser(nextUser);
              }}
            />
          )
        }
      />
      <Route
        path="/register"
        element={
          user ? (
            <Navigate to="/" replace />
          ) : (
            <RegisterPage
              onAuth={(token, nextUser) => {
                setToken(token);
                setUser(nextUser);
              }}
            />
          )
        }
      />
      <Route
        path="/game/:gameId"
        element={
          <ProtectedRoute user={user}>
            <GamePage user={user as User} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute user={user}>
            <DashboardPage
              user={user as User}
              onLogout={() => {
                clearToken();
                setUser(null);
              }}
            />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
