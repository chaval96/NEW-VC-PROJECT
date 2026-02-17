import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyEmail } from "../api";
import { Card, CardBody, CardHeader } from "../components/ui/Card";

export function VerifyEmailPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") ?? "", [params]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    const run = async (): Promise<void> => {
      if (!token) {
        setStatus("error");
        setMessage("Verification token is missing.");
        return;
      }

      try {
        await verifyEmail(token);
        setStatus("success");
        setMessage("Your email is verified. You can now sign in.");
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Email verification failed");
      }
    };

    void run();
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-md animate-fade-in">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">Email Verification</h2>
          </CardHeader>
          <CardBody>
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                status === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : status === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {message}
            </div>

            <div className="mt-4 text-sm">
              <Link className="font-medium text-primary-700 hover:underline" to="/login">
                Go to login
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
