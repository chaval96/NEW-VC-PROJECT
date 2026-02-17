import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

const strictEmailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [resetUrl, setResetUrl] = useState<string>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    setSuccess(undefined);
    setResetUrl(undefined);

    if (!strictEmailPattern.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await forgotPassword(email.trim());
      setSuccess(result.message);
      setResetUrl(result.resetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to request password reset.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-md animate-fade-in">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">Reset Password</h2>
            <p className="mt-1 text-sm text-slate-500">Enter your email and we will send a password reset link.</p>
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

              {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
              {success ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}
              {resetUrl ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Development reset link: <a className="font-medium underline" href={resetUrl}>{resetUrl}</a>
                </div>
              ) : null}

              <Button className="w-full" type="submit" disabled={submitting || email.trim().length === 0}>
                {submitting ? "Sending..." : "Send reset link"}
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
