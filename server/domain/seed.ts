import dayjs from "dayjs";
import { v4 as uuid } from "uuid";
import type { AppState, CompanyProfile, Firm, PipelineStage, SubmissionEvent, SubmissionStatus, Workspace } from "./types.js";

const STAGE_ORDER: PipelineStage[] = [
  "lead",
  "researching",
  "qualified",
  "form_discovered",
  "form_filled",
  "submitted",
  "review",
  "won",
  "lost"
];

function pickStage(index: number): PipelineStage {
  return STAGE_ORDER[index % STAGE_ORDER.length] ?? "lead";
}

export function buildTemplateProfile(companyName = "New Company"): CompanyProfile {
  return {
    company: companyName,
    website: "https://example.com",
    oneLiner: `${companyName} is a high-growth technology company raising capital for expansion.`,
    longDescription:
      `${companyName} builds products for global markets and is preparing investor outreach through structured website form submissions.`,
    senderName: "Founder Name",
    senderTitle: "Founder",
    senderEmail: "founder@example.com",
    senderPhone: "+1 000 000 0000",
    linkedin: "https://www.linkedin.com/",
    calendly: "https://calendly.com/",
    metrics: {
      arr: "$0",
      mrr: "$0",
      subscribers: "0",
      countries: "0",
      ltvCac: "0x",
      churn: "0%",
      cumulativeRevenue: "$0"
    },
    fundraising: {
      round: "Seed",
      amount: "$1,000,000",
      valuation: "$10M",
      secured: "0%",
      instrument: "SAFE",
      deckUrl: "https://example.com/deck",
      dataRoomUrl: "https://example.com/data-room"
    }
  };
}

function buildWaskProfile(): CompanyProfile {
  return {
    company: "WASK Inc.",
    website: "https://www.wask.co",
    oneLiner:
      "WASK is an Agentic AI AdTech platform that automates Google and Meta ad optimization with minimal human effort.",
    longDescription:
      "WASK enables businesses to run, optimize, and maximize Google and Meta ad performance through autonomous optimization flows, omnichannel analytics, and AI-powered creative generation.",
    senderName: "Utku Bozkurt",
    senderTitle: "Co-Founder & Chief Strategy Officer",
    senderEmail: "investment@wask.co",
    senderPhone: "+44 7435583335",
    linkedin: "https://www.linkedin.com/in/utku-bozkurtt/",
    calendly: "https://calendly.com/utku_bozkurt/intro-call?month=2026-02",
    metrics: {
      arr: "$2.1M",
      mrr: "$180K",
      subscribers: "7,000+",
      countries: "130+",
      ltvCac: "4.80x",
      churn: "4.21%",
      cumulativeRevenue: "$6.8M"
    },
    fundraising: {
      round: "Series A",
      amount: "$4,000,000",
      valuation: "$22.4M",
      secured: "60% (~$2.4M)",
      instrument: "SAFE",
      deckUrl: "https://wask.docsend.com/view/6t5b4788rzun7ew7",
      dataRoomUrl: "https://waskinc-dataroom.notion.site/"
    }
  };
}

const firmSeed = [
  ["Grand Strand Angel Network", "http://www.grandstrandangelnetwork.com", "US", "Angel Network", "$50K-$500K", ["SaaS", "B2B"]],
  ["757 Angels", "http://www.757angelsgroup.com/", "US", "Angel Network", "$100K-$1M", ["SaaS", "AI"]],
  ["Accelerate Venture Partners", "https://www.midwestventure.com", "US", "VC", "$500K-$5M", ["AdTech", "AI"]],
  ["Accelerating Angels", "https://acceleratingangels.com/", "US", "Angel Network", "$50K-$750K", ["AI", "Marketing"]],
  ["AccelHUB Venture Partners", "https://www.accelhub.co/accelhub-venture-partners", "US", "VC", "$500K-$5M", ["AdTech", "SaaS"]],
  ["Aggie Angel Network", "http://aggieangelnetwork.com/", "US", "Angel Network", "$100K-$1M", ["Enterprise", "B2B"]],
  ["Alabama Capital Network", "http://www.alabamacapitalnetwork.com", "US", "Syndicate", "$250K-$2M", ["SaaS", "FinTech"]],
  ["Alamo Angels", "http://alamoangels.com/", "US", "Angel Network", "$100K-$1M", ["AI", "B2B"]],
  ["Alliance of Angels", "https://www.allianceofangels.com", "US", "Angel Network", "$250K-$2M", ["SaaS", "Cloud"]],
  ["Angel Forum Vancouver", "https://www.angelforum.org", "Canada", "Angel Network", "$250K-$2M", ["AdTech", "Growth"]],
  ["Angel Investor Forum", "https://www.angelinvestorforum.com", "US", "Angel Network", "$100K-$1M", ["AI", "SaaS"]],
  ["Angel One Investor Network", "https://www.angelonenetwork.ca", "Canada", "Syndicate", "$250K-$2M", ["B2B", "AdTech"]],
  ["Angel Star Ventures", "https://angelstarventures.com/", "US", "VC", "$500K-$4M", ["SaaS", "AI"]],
  ["Angeles Investors", "http://www.angelesinvestors.com", "US", "Angel Network", "$100K-$1M", ["Enterprise", "Marketing"]],
  ["Appalachian Investors Alliance", "https://appalachianinvestors.org/", "US", "Syndicate", "$250K-$2M", ["SaaS", "AI"]]
] as const;

function generateFirms(workspaceId: string): Firm[] {
  return firmSeed.map((entry, index) => {
    const [name, website, geography, investorType, checkSizeRange, focusSectors] = entry;
    const id = uuid();
    const score = 55 + ((index * 7) % 45);
    const stage = pickStage(index + 2);

    return {
      id,
      workspaceId,
      name,
      website,
      geography,
      investorType,
      checkSizeRange,
      focusSectors: [...focusSectors],
      stageFocus: ["Seed", "Series A", "Growth"],
      stage,
      score,
      statusReason: stage === "qualified" ? "High thesis fit" : "Pending form workflow",
      contacts: [
        {
          id: uuid(),
          name: `Partner ${index + 1}`,
          title: "General Partner",
          email: `partner${index + 1}@${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`
        }
      ],
      notes: [],
      lastTouchedAt: dayjs().subtract(index % 10, "day").toISOString()
    };
  });
}

function syntheticStatus(index: number): SubmissionStatus {
  if (index % 17 === 0) return "blocked";
  if (index % 11 === 0) return "no_form_found";
  if (index % 7 === 0) return "submitted";
  if (index % 4 === 0) return "form_filled";
  if (index % 3 === 0) return "form_discovered";
  return "queued";
}

function generateEvents(workspaceId: string, firms: Firm[]): SubmissionEvent[] {
  const events: SubmissionEvent[] = [];

  for (let i = 0; i < 42; i += 1) {
    const firm = firms[i % firms.length];
    const base = dayjs().subtract(42 - i, "day").hour(10 + (i % 6)).minute((i % 4) * 10);
    const status = syntheticStatus(i + 1);
    const attemptedAt = base.toISOString();

    events.push({
      id: uuid(),
      workspaceId,
      firmId: firm.id,
      firmName: firm.name,
      channel: "website_form",
      status,
      attemptedAt,
      discoveredAt: ["form_discovered", "form_filled", "submitted"].includes(status)
        ? base.add(8, "minute").toISOString()
        : undefined,
      filledAt: ["form_filled", "submitted"].includes(status)
        ? base.add(20, "minute").toISOString()
        : undefined,
      submittedAt: status === "submitted" ? base.add(28, "minute").toISOString() : undefined,
      blockedReason: status === "blocked" ? "CAPTCHA Blocked" : undefined,
      note:
        status === "no_form_found"
          ? "No startup submission route found in nav/footer"
          : status === "submitted"
            ? "Submission completed and confirmation captured"
            : undefined
    });
  }

  return events;
}

export function createWorkspace(name: string, profile: CompanyProfile): Workspace {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    name,
    profile,
    createdAt: now,
    updatedAt: now
  };
}

export function createSeedState(): AppState {
  const workspace = createWorkspace("WASK Fundraising", buildWaskProfile());
  const firms = generateFirms(workspace.id);

  return {
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    firms,
    submissionEvents: generateEvents(workspace.id, firms),
    submissionRequests: [],
    importBatches: [],
    tasks: [],
    runs: [],
    logs: []
  };
}
