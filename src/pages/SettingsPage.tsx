import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { activateWorkspace, changeMyPassword, getProfile, updateMyProfile, updateWorkspaceProfile } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input, Textarea } from "../components/ui/Input";
import type { AuthUser } from "../types";
import type { CompanyProfile } from "@shared/types";

interface SettingsPageProps {
  user: AuthUser;
  onAuthUserUpdated: (user: AuthUser) => void;
}

const strictEmailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const urlPattern = /^https?:\/\/.+/i;

export function SettingsPage({ user, onAuthUserUpdated }: SettingsPageProps): JSX.Element {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [name, setName] = useState(user.name);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!workspaceId) {
      navigate("/projects");
      return;
    }

    const load = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
        const loaded = await getProfile(workspaceId);
        setProfile(loaded);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings.");
      }
    };

    void load();
  }, [workspaceId, navigate]);

  const saveAccount = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);

    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }

    setSavingAccount(true);
    try {
      const result = await updateMyProfile({ name: name.trim() });
      onAuthUserUpdated(result.user);
      setNotice("Account profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account profile.");
    } finally {
      setSavingAccount(false);
    }
  };

  const saveCompanyProfile = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!workspaceId || !profile) return;

    setError(undefined);
    setNotice(undefined);

    if (!profile.company.trim()) {
      setError("Company name is required.");
      return;
    }
    if (!urlPattern.test(profile.website.trim())) {
      setError("Company website must start with http:// or https://");
      return;
    }
    if (!strictEmailPattern.test(profile.senderEmail.trim())) {
      setError("Founder email is invalid.");
      return;
    }

    setSavingCompany(true);
    try {
      await updateWorkspaceProfile(workspaceId, profile);
      setNotice("Project settings updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update project settings.");
    } finally {
      setSavingCompany(false);
    }
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);

    if (currentPassword.length < 8) {
      setError("Current password must be at least 8 characters.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from current password.");
      return;
    }

    setChangingPassword(true);
    try {
      await changeMyPassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password updated. Please sign in again on other devices.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-slate-500">Manage account security and project defaults.</p>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Account Profile</h2>
          </CardHeader>
          <CardBody>
            <form className="space-y-3" onSubmit={(event) => void saveAccount(event)}>
              <Input label="Full Name" value={name} onChange={(event) => setName(event.target.value)} />
              <Input label="Email" value={user.email} disabled />
              <Button type="submit" disabled={savingAccount}>
                {savingAccount ? "Saving..." : "Save account"}
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Change Password</h2>
          </CardHeader>
          <CardBody>
            <form className="space-y-3" onSubmit={(event) => void savePassword(event)}>
              <Input
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <Input
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <Input
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <Button type="submit" disabled={changingPassword}>
                {changingPassword ? "Updating..." : "Update password"}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold">Project Defaults</h2>
        </CardHeader>
        <CardBody>
          {!profile ? (
            <p className="text-sm text-slate-500">Loading project settings...</p>
          ) : (
            <form className="space-y-3" onSubmit={(event) => void saveCompanyProfile(event)}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  label="Company Name"
                  value={profile.company}
                  onChange={(event) => setProfile((prev) => (prev ? { ...prev, company: event.target.value } : prev))}
                />
                <Input
                  label="Company Website"
                  value={profile.website}
                  onChange={(event) => setProfile((prev) => (prev ? { ...prev, website: event.target.value } : prev))}
                />
                <Input
                  label="Founder Name"
                  value={profile.senderName}
                  onChange={(event) => setProfile((prev) => (prev ? { ...prev, senderName: event.target.value } : prev))}
                />
                <Input
                  label="Founder Email"
                  value={profile.senderEmail}
                  onChange={(event) => setProfile((prev) => (prev ? { ...prev, senderEmail: event.target.value } : prev))}
                />
                <Input
                  label="Round"
                  value={profile.fundraising.round}
                  onChange={(event) =>
                    setProfile((prev) =>
                      prev ? { ...prev, fundraising: { ...prev.fundraising, round: event.target.value } } : prev
                    )
                  }
                />
                <Input
                  label="Target Amount"
                  value={profile.fundraising.amount}
                  onChange={(event) =>
                    setProfile((prev) =>
                      prev ? { ...prev, fundraising: { ...prev.fundraising, amount: event.target.value } } : prev
                    )
                  }
                />
              </div>
              <Textarea
                label="One-liner"
                rows={2}
                value={profile.oneLiner}
                onChange={(event) => setProfile((prev) => (prev ? { ...prev, oneLiner: event.target.value } : prev))}
              />
              <Textarea
                label="Long Description"
                rows={4}
                value={profile.longDescription}
                onChange={(event) => setProfile((prev) => (prev ? { ...prev, longDescription: event.target.value } : prev))}
              />
              <Button type="submit" disabled={savingCompany}>
                {savingCompany ? "Saving..." : "Save project defaults"}
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
