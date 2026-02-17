import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { signup } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps): JSX.Element {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [verificationUrl, setVerificationUrl] = useState<string>();

  const handleLogin = async (): Promise<void> => {
    await onLogin(email.trim(), password);
  };

  const handleSignup = async (): Promise<void> => {
    if (password !== confirmPassword) {
      throw new Error("Passwords do not match");
    }

    const response = await signup({
      name: name.trim(),
      email: email.trim(),
      password
    });

    setSuccess(response.message);
    setVerificationUrl(response.verificationUrl);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setSuccess(undefined);
    setVerificationUrl(undefined);

    try {
      if (mode === "login") {
        await handleLogin();
      } else {
        await handleSignup();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "login" ? "Login failed" : "Signup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-md animate-fade-in">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">VCReach</h1>
          <p className="mt-2 text-sm text-slate-500">AI-powered VC website form operations for startups.</p>
        </div>

        <Card>
          <CardHeader>
            <div className="mb-2 flex rounded-lg bg-slate-100 p-1">
              <button
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${mode === "login" ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}
                onClick={() => setMode("login")}
                type="button"
              >
                Login
              </button>
              <button
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${mode === "signup" ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}
                onClick={() => setMode("signup")}
                type="button"
              >
                Sign Up
              </button>
            </div>
            <h2 className="text-base font-semibold text-slate-900">{mode === "login" ? "Sign in" : "Create your account"}</h2>
          </CardHeader>
          <CardBody>
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              {mode === "signup" ? (
                <Input
                  label="Full Name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Utku Bozkurt"
                  required
                />
              ) : null}

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
                placeholder="At least 8 characters"
                required
              />

              {mode === "signup" ? (
                <Input
                  label="Confirm Password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat password"
                  required
                />
              ) : null}

              {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
              {success ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}

              {verificationUrl ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Development verification link: <a className="font-medium underline" href={verificationUrl}>{verificationUrl}</a>
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={
                  submitting ||
                  email.trim().length === 0 ||
                  password.length === 0 ||
                  (mode === "signup" && (name.trim().length < 2 || confirmPassword.length === 0))
                }
              >
                {submitting ? (mode === "login" ? "Signing in..." : "Creating account...") : mode === "login" ? "Sign in" : "Create account"}
              </Button>

              <p className="text-xs text-slate-400">
                Need to verify your email first? Check your inbox and open the verification link. You can also open it manually via the
                dev link shown after signup.
              </p>

              <div className="text-xs text-slate-400">
                Already have a token link? <Link className="text-primary-700 hover:underline" to="/verify-email">Open verify page</Link>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
