import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { activateWorkspace, createWorkspace, getWorkspaces } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import type { Workspace } from "@shared/types";
import dayjs from "dayjs";

export function ProjectsPage(): JSX.Element {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const res = await getWorkspaces();
      setWorkspaces(res.workspaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onCreate = async (): Promise<void> => {
    if (name.trim().length < 2) return;
    try {
      const ws = await createWorkspace({ name: name.trim(), company: company.trim() || undefined, website: website.trim() || undefined });
      setName(""); setCompany(""); setWebsite("");
      navigate(`/projects/${ws.id}/onboarding`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    }
  };

  const onOpen = async (workspaceId: string): Promise<void> => {
    try {
      await activateWorkspace(workspaceId);
      navigate(`/projects/${workspaceId}/dashboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open project");
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Projects</h1>
        <p className="mt-1 text-slate-500">Select a fundraising project or create a new one.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <Card className="mb-6">
        <CardHeader><h3 className="text-base font-semibold">Create Project</h3></CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} />
            <Input placeholder="Website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <Button className="mt-3" onClick={() => void onCreate()}>Create & Setup</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-semibold">Existing Projects</h3></CardHeader>
        <CardBody className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Project</th>
                  <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Company</th>
                  <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Updated</th>
                  <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500"></th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((ws) => (
                  <tr key={ws.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium">{ws.name}</td>
                    <td className="px-5 py-3 text-slate-600">{ws.profile.company}</td>
                    <td className="px-5 py-3 text-slate-500">{dayjs(ws.updatedAt).format("MMM D, YYYY")}</td>
                    <td className="px-5 py-3">
                      <Button size="sm" variant="secondary" onClick={() => void onOpen(ws.id)}>Open</Button>
                    </td>
                  </tr>
                ))}
                {workspaces.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">No projects yet. Create one above.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
