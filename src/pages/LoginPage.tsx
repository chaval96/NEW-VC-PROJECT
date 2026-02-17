import { FormEvent, useState } from "react";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);

    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-md animate-fade-in">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">VCReach</h1>
          <p className="mt-2 text-sm text-slate-500">Sign in to manage startup fundraising outreach projects.</p>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">Login</h2>
          </CardHeader>
          <CardBody>
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="founder@startup.com"
                required
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                required
              />

              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting || email.trim().length === 0 || password.length === 0}>
                {submitting ? "Signing in..." : "Sign in"}
              </Button>

              <p className="text-xs text-slate-400">
                First setup default credentials can be configured via <code>AUTH_EMAIL</code> and <code>AUTH_PASSWORD</code>.
              </p>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
