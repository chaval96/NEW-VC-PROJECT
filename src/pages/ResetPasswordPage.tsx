import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

export function ResetPasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") ?? "", [params]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    setSuccess(undefined);

    if (!token) {
      setError("Reset token is missing.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await resetPassword(token, password);
      setSuccess(result.message);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-md animate-fade-in">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">Create New Password</h2>
            <p className="mt-1 text-sm text-slate-500">Choose a secure password for your account.</p>
          </CardHeader>
          <CardBody>
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <Input
                label="New Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                required
              />
              <Input
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat password"
                required
              />

              {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
              {success ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}

              <Button className="w-full" type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Reset password"}
              </Button>

              <div className="text-xs text-slate-400">
                Back to <Link className="text-primary-700 hover:underline" to="/login">login</Link>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
