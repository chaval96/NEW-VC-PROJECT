import { Link, useLocation } from "react-router-dom";
import type { AuthUser } from "../types";
import { Button } from "./ui/Button";
import { ThemeToggle } from "./ui/ThemeToggle";

interface NavbarProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export function Navbar({ user, onLogout }: NavbarProps): JSX.Element {
  const location = useLocation();
  const workspaceMatch = location.pathname.match(/^\/projects\/([^/]+)\/(dashboard|onboarding|settings|operations)$/);
  const workspaceId = workspaceMatch?.[1] ?? location.pathname.match(/^\/projects\/([^/]+)/)?.[1];

  const navLink = (to: string, label: string): JSX.Element => {
    const active = location.pathname === to;
    return (
      <Link
        to={to}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          active
            ? "bg-primary-50 text-primary-700 dark:bg-primary-600/20 dark:text-primary-300"
            : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/projects" className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            VC<span className="text-primary-600 dark:text-primary-400">Reach</span>
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {navLink("/projects", "Projects")}
            {workspaceId ? navLink(`/projects/${workspaceId}/dashboard`, "Dashboard") : null}
            {workspaceId ? navLink(`/projects/${workspaceId}/operations`, "Operations") : null}
            {workspaceId ? navLink(`/projects/${workspaceId}/onboarding`, "Knowledge Base") : null}
            {workspaceId ? navLink(`/projects/${workspaceId}/settings`, "Settings") : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden sm:block text-right">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{user.name}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{user.email}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void onLogout()}>
            Logout
          </Button>
        </div>
      </div>
    </nav>
  );
}
