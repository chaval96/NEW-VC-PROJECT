import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { clearAuthToken, getAuthToken, getMe, login, logout, setAuthToken } from "./api";
import { Navbar } from "./components/Navbar";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import type { AuthUser } from "./types";

function ProtectedRoute({ user, children }: { user: AuthUser | null; children: JSX.Element }): JSX.Element {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App(): JSX.Element {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const bootstrapAuth = async (): Promise<void> => {
      if (!getAuthToken()) {
        setAuthLoading(false);
        return;
      }

      try {
        const me = await getMe();
        setAuthUser(me.user);
      } catch {
        clearAuthToken();
        setAuthUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    void bootstrapAuth();
  }, []);

  const handleLogin = async (email: string, password: string): Promise<void> => {
    const response = await login(email, password);
    setAuthToken(response.token);
    setAuthUser(response.user);
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await logout();
    } catch {
      // best effort
    }
    clearAuthToken();
    setAuthUser(null);
  };

  if (authLoading) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        {authUser ? <Navbar user={authUser} onLogout={handleLogout} /> : null}
        <Routes>
          <Route path="/login" element={authUser ? <Navigate to="/projects" replace /> : <LoginPage onLogin={handleLogin} />} />

          <Route
            path="/projects"
            element={
              <ProtectedRoute user={authUser}>
                <ProjectsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:workspaceId/onboarding"
            element={
              <ProtectedRoute user={authUser}>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:workspaceId/dashboard"
            element={
              <ProtectedRoute user={authUser}>
                <DashboardPage user={authUser as AuthUser} />
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<Navigate to={authUser ? "/projects" : "/login"} replace />} />
          <Route path="*" element={<Navigate to={authUser ? "/projects" : "/login"} replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
