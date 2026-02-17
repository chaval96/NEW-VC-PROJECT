import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  activateWorkspace,
  getProfile,
  getWorkspaceReadiness,
  importFirmsFile,
  importFirmsFromDrive,
  updateWorkspaceProfile
} from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody } from "../components/ui/Card";
import { Input, Textarea } from "../components/ui/Input";
import { ProgressSteps } from "../components/ui/ProgressSteps";
import type { CompanyProfile } from "@shared/types";

const STEPS = [
  { label: "Company" },
  { label: "Fundraising" },
  { label: "Metrics" },
  { label: "Investors" },
  { label: "Ready" }
];

const defaultProfile: CompanyProfile = {
  company: "",
  website: "",
  oneLiner: "",
  longDescription: "",
  senderName: "",
  senderTitle: "",
  senderEmail: "",
  senderPhone: "",
  linkedin: "",
  calendly: "",
  metrics: { arr: "", mrr: "", subscribers: "", countries: "", ltvCac: "", churn: "", cumulativeRevenue: "" },
  fundraising: { round: "Seed", amount: "", valuation: "", secured: "", instrument: "SAFE", deckUrl: "", dataRoomUrl: "" }
};

const strictEmailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const urlPattern = /^https?:\/\/.+/i;
const drivePattern = /^https:\/\/(docs|drive)\.google\.com\//i;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed"));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export function OnboardingPage(): JSX.Element {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<CompanyProfile>(defaultProfile);
  const [driveLink, setDriveLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [investorCount, setInvestorCount] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  const p = useCallback((patch: Partial<CompanyProfile>) => setProfile((prev) => ({ ...prev, ...patch })), []);
  const pm = useCallback(
    (patch: Partial<CompanyProfile["metrics"]>) =>
      setProfile((prev) => ({ ...prev, metrics: { ...prev.metrics, ...patch } })),
    []
  );
  const pf = useCallback(
    (patch: Partial<CompanyProfile["fundraising"]>) =>
      setProfile((prev) => ({ ...prev, fundraising: { ...prev.fundraising, ...patch } })),
    []
  );

  useEffect(() => {
    if (!workspaceId) return;

    const load = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
        const [existing, readiness] = await Promise.all([getProfile(workspaceId), getWorkspaceReadiness(workspaceId)]);
        setProfile(existing);
        setInvestorCount(readiness.investorCount);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [workspaceId]);

  const validateStep = (currentStep: number): boolean => {
    const nextErrors: Record<string, string | undefined> = {};

    if (currentStep === 0) {
      if (!profile.company.trim()) nextErrors.company = "Company name is required.";
      if (!urlPattern.test(profile.website.trim())) nextErrors.website = "Website must start with http:// or https://";
      if (!profile.senderName.trim()) nextErrors.senderName = "Founder name is required.";
      if (!strictEmailPattern.test(profile.senderEmail.trim())) nextErrors.senderEmail = "Founder email is invalid.";
      if (!profile.oneLiner.trim()) nextErrors.oneLiner = "One-liner is required.";
      if (!profile.longDescription.trim()) nextErrors.longDescription = "Long description is required.";
    }

    if (currentStep === 1) {
      if (!profile.fundraising.round.trim()) nextErrors.round = "Funding round is required.";
      if (!profile.fundraising.amount.trim()) nextErrors.amount = "Target amount is required.";
      if (profile.fundraising.deckUrl && !urlPattern.test(profile.fundraising.deckUrl.trim())) {
        nextErrors.deckUrl = "Deck URL must start with http:// or https://";
      }
      if (profile.fundraising.dataRoomUrl && !urlPattern.test(profile.fundraising.dataRoomUrl.trim())) {
        nextErrors.dataRoomUrl = "Data room URL must start with http:// or https://";
      }
    }

    if (currentStep === 3 && investorCount === 0) {
      nextErrors.investors = "Import at least one investor list before continuing.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const saveAndAdvance = async (): Promise<void> => {
    if (!workspaceId) return;
    if (!validateStep(step)) return;

    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await updateWorkspaceProfile(workspaceId, profile);
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!workspaceId) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setError(undefined);
    setNotice(undefined);
    if (![".csv", ".xlsx", ".xls"].some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setError("Only CSV, XLSX or XLS files are supported.");
      event.target.value = "";
      return;
    }

    try {
      const base64Data = await fileToBase64(file);
      const result = await importFirmsFile({
        workspaceId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64Data
      });
      const readiness = await getWorkspaceReadiness(workspaceId);
      setInvestorCount(readiness.investorCount);
      setNotice(`Imported ${result.imported} investors from ${file.name}.`);
      setFieldErrors((prev) => ({ ...prev, investors: undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      event.target.value = "";
    }
  };

  const onImportDrive = async (): Promise<void> => {
    if (!workspaceId) return;
    if (!driveLink.trim()) {
      setError("Google Drive link is required.");
      return;
    }
    if (!drivePattern.test(driveLink.trim())) {
      setError("Please enter a valid Google Drive share link.");
      return;
    }
    try {
      const result = await importFirmsFromDrive(workspaceId, driveLink.trim());
      const readiness = await getWorkspaceReadiness(workspaceId);
      setInvestorCount(readiness.investorCount);
      setNotice(`Imported ${result.imported} investors from Google Drive.`);
      setFieldErrors((prev) => ({ ...prev, investors: undefined }));
      setDriveLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Drive import failed");
    }
  };

  const onFinish = async (): Promise<void> => {
    if (!workspaceId) return;
    if (!validateStep(0) || !validateStep(1) || !validateStep(3)) return;

    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await updateWorkspaceProfile(workspaceId, profile);
      navigate(`/projects/${workspaceId}/dashboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-3xl px-6 py-8" />;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Project Knowledge Base</h1>
        <p className="mt-1 text-sm text-slate-500">Provide company details used by AI agents during investor form submissions.</p>
      </div>

      <div className="mb-8">
        <ProgressSteps steps={STEPS} currentStep={step} />
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      ) : null}

      <Card>
        <CardBody>
          {step === 0 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Company Basics</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  label="Company Name"
                  value={profile.company}
                  error={fieldErrors.company}
                  onChange={(event) => p({ company: event.target.value })}
                />
                <Input
                  label="Website"
                  value={profile.website}
                  error={fieldErrors.website}
                  onChange={(event) => p({ website: event.target.value })}
                />
                <Input
                  label="Founder Name"
                  value={profile.senderName}
                  error={fieldErrors.senderName}
                  onChange={(event) => p({ senderName: event.target.value })}
                />
                <Input label="Title" value={profile.senderTitle} onChange={(event) => p({ senderTitle: event.target.value })} />
                <Input
                  label="Email"
                  value={profile.senderEmail}
                  error={fieldErrors.senderEmail}
                  onChange={(event) => p({ senderEmail: event.target.value })}
                />
                <Input label="Phone" value={profile.senderPhone} onChange={(event) => p({ senderPhone: event.target.value })} />
                <Input label="LinkedIn" value={profile.linkedin} onChange={(event) => p({ linkedin: event.target.value })} />
                <Input label="Calendly" value={profile.calendly} onChange={(event) => p({ calendly: event.target.value })} />
              </div>
              <Textarea
                label="One-liner"
                rows={2}
                error={fieldErrors.oneLiner}
                value={profile.oneLiner}
                onChange={(event) => p({ oneLiner: event.target.value })}
              />
              <Textarea
                label="Long Description"
                rows={4}
                error={fieldErrors.longDescription}
                value={profile.longDescription}
                onChange={(event) => p({ longDescription: event.target.value })}
              />
              <Button onClick={() => void saveAndAdvance()} disabled={saving}>
                {saving ? "Saving..." : "Next"}
              </Button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Fundraising Details</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  label="Round"
                  value={profile.fundraising.round}
                  error={fieldErrors.round}
                  onChange={(event) => pf({ round: event.target.value })}
                />
                <Input
                  label="Amount"
                  value={profile.fundraising.amount}
                  error={fieldErrors.amount}
                  onChange={(event) => pf({ amount: event.target.value })}
                />
                <Input label="Valuation" value={profile.fundraising.valuation} onChange={(event) => pf({ valuation: event.target.value })} />
                <Input label="Instrument" value={profile.fundraising.instrument} onChange={(event) => pf({ instrument: event.target.value })} />
                <Input label="Secured" value={profile.fundraising.secured} onChange={(event) => pf({ secured: event.target.value })} />
                <Input
                  label="Deck URL"
                  error={fieldErrors.deckUrl}
                  value={profile.fundraising.deckUrl}
                  onChange={(event) => pf({ deckUrl: event.target.value })}
                />
                <Input
                  label="Data Room URL"
                  error={fieldErrors.dataRoomUrl}
                  value={profile.fundraising.dataRoomUrl}
                  onChange={(event) => pf({ dataRoomUrl: event.target.value })}
                />
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button onClick={() => void saveAndAdvance()} disabled={saving}>
                  {saving ? "Saving..." : "Next"}
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Business Metrics</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input label="ARR" value={profile.metrics.arr} onChange={(event) => pm({ arr: event.target.value })} />
                <Input label="MRR" value={profile.metrics.mrr} onChange={(event) => pm({ mrr: event.target.value })} />
                <Input label="Customers" value={profile.metrics.subscribers} onChange={(event) => pm({ subscribers: event.target.value })} />
                <Input label="Countries" value={profile.metrics.countries} onChange={(event) => pm({ countries: event.target.value })} />
                <Input label="LTV/CAC" value={profile.metrics.ltvCac} onChange={(event) => pm({ ltvCac: event.target.value })} />
                <Input label="Churn" value={profile.metrics.churn} onChange={(event) => pm({ churn: event.target.value })} />
                <Input
                  label="Cumulative Revenue"
                  value={profile.metrics.cumulativeRevenue}
                  onChange={(event) => pm({ cumulativeRevenue: event.target.value })}
                />
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button onClick={() => void saveAndAdvance()} disabled={saving}>
                  {saving ? "Saving..." : "Next"}
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Import Investor Lists</h2>
              <p className="text-sm text-slate-500">
                Upload CSV/Excel files or connect a Google Drive file. You can start processing later from the dashboard.
              </p>

              <label className="flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 transition-colors hover:border-primary-400">
                <div className="text-center">
                  <p className="font-medium text-slate-700">Upload CSV / XLSX</p>
                  <p className="mt-1 text-xs text-slate-400">Drag and drop or click to select</p>
                </div>
                <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={(event) => void onUpload(event)} />
              </label>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  placeholder="Google Drive share link"
                  error={fieldErrors.investors}
                  value={driveLink}
                  onChange={(event) => setDriveLink(event.target.value)}
                  className="sm:flex-1"
                />
                <Button variant="secondary" onClick={() => void onImportDrive()}>
                  Import from Drive
                </Button>
              </div>

              <p className="text-xs text-slate-500">Imported investors: {investorCount}</p>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={() => void saveAndAdvance()} disabled={saving}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Ready to Run</h2>
              <p className="text-sm text-slate-500">
                Your project knowledge base is configured. Continue to dashboard to review pipeline and run VC form submission workflows.
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p>
                  <strong>{profile.company || "Company"}</strong> · {profile.fundraising.round} · {profile.fundraising.amount || "Amount TBD"}
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep(3)}>
                  Back
                </Button>
                <Button onClick={() => void onFinish()} disabled={saving}>
                  {saving ? "Saving..." : "Go to Dashboard"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
