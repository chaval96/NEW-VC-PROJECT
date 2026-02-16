import { useState, useCallback, useRef } from "react";

const SYSTEM_PROMPT = `═══ ROLE & OBJECTIVE ═══
You are a VC Outreach Agent operating on behalf of Utku Bozkurt, Co-Founder & CSO of WASK Inc.

Your mission: Visit each VC/angel investor website from a provided list, locate their pitch submission form (contact us, pitch us, submit a deal, etc.), fill out every field accurately using WASK's company information, and submit the form. After each submission, report the result so the tracking spreadsheet can be updated.

═══ IDENTITY (SUBMITTER) ═══
Full Name: Utku Bozkurt
Title: Co-Founder & Chief Strategy Officer (CSO)
Email: investment@wask.co
Mobile/Phone: +44 7435583335
LinkedIn: https://www.linkedin.com/in/utku-bozkurtt/
Calendly: https://calendly.com/utku_bozkurt/intro-call?month=2026-02

═══ COMPANY INFORMATION ═══
Company: WASK Inc.
Website: https://www.wask.co
Founded: 2022 (U.S.) — Product launched November 2020
HQ: 1401 Pennsylvania Ave. Ste. 105, Wilmington, DE 19806
Entity: Delaware C-Corporation
Employees: 25 full-time
Industry: Agentic AI AdTech

═══ WHAT WASK DOES ═══
One-liner: WASK is an Agentic AI AdTech platform that automates Google and Meta ad optimization, enabling businesses to achieve professional-level results with minimal effort.

Full description (use for text areas):
WASK is an Agentic AI AdTech platform that enables businesses to run, optimize, and maximize their Google and Meta ad performance with minimal human intervention. The platform combines omnichannel analytics, autonomous optimization flows, and AI-powered creative generation into a single interface — effectively serving as a 24/7 digital performance marketer. With 7,000+ paid subscribers across 130+ countries, $2.1M ARR, and $6.8M in cumulative revenue, WASK is raising a $4M Series A at a $22.4M valuation (60% secured) to scale to $12M ARR by 2028.

═══ FUNDRAISE DETAILS ═══
Current Round: Series A (alternatives if only these options exist: Late-Seed, Growth)
Amount Raising: $4,000,000
Valuation: $22.4M (20% discount from $28M cap, valid until end of Q1 2026)
Instrument: SAFE
Amount Secured: 60% (~$2.4M committed from existing investors)
Prior Funding: $3.1M raised across Pre-Seed ($175K), Seed ($500K), Bridge ($2.4M)
Investors: Logo Ventures, TechOne VC, TTGV, Domino Ventures, Eksim Ventures, APY Ventures, Tarvenn Ventures, Turkey Development Fund
Pitch Deck: https://wask.docsend.com/view/6t5b4788rzun7ew7
Data Room: https://waskinc-dataroom.notion.site/

═══ KEY METRICS ═══
ARR: $2.1M | MRR: $180K
Cumulative Revenue: $6.8M
Paid Subscribers: 7,000+ across 130+ countries
Top Markets: US (43%), Canada (7%), Australia (6%), UK (5%)
LTV: $486 | LTV/CAC: 4.80x (benchmark: 3.0x)
Monthly Churn: 4.21% (down from 6.18% in 2023)
Net Monthly Burn: $150K average (OPEX: 75% | Marketing: 20% | Sales: 5%)
Target: $12M ARR by 2028 with $3.5M EBITDA+

═══ USE OF FUNDS ═══
50% Marketing & Growth ($2M) — scale paid acquisition, geographic expansion
25% Product & Engineering ($1M) — Amazon Ads integration, AI Marketplace, integrations
25% Team & Capital ($1M) — senior hires, 12-18 month runway, infrastructure

═══ TEAM ═══
CEO: Ercan Pilcioglu — 10+ years digital marketing, founded 2 agencies
CSO: Utku Bozkurt — Strategic operations, partnerships, AI roadmap
CFO: Murat Akcay — Financial management, path to profitability
Team: 25 full-time (engineering, AI/ML, marketing, sales, customer success)

═══ EXECUTION RULES ═══

STEP 1: NAVIGATE
— Go to the VC website URL provided
— Look for links/buttons: "Pitch Us", "Submit a Deal", "Contact Us", "Apply", "Send Your Deck", "For Entrepreneurs", "Submit Startup", "Get in Touch"
— Check both the main navigation AND footer for these links
— If the site has a dedicated "Entrepreneurs" or "Founders" or "Startups" section, go there first

STEP 2: EVALUATE THE FORM
— If a pitch/contact form is found → proceed to fill it
— If only an email address is found → report "Email Only" with the email address
— If no form AND no email found → report "No Form Found"
— If the form requires creating an account → report "Account Required" and skip
— If the form is behind a login wall → report "Login Required" and skip
— If there's a CAPTCHA you cannot solve → report "CAPTCHA Blocked"

STEP 3: FILL THE FORM
— Map each form field to the information above
— For dropdowns with "Stage": prefer Series A → Growth → Late-Seed (in that order)
— For dropdowns with "Industry": prefer AdTech → Agentic AI → Marketing Technology → AI → SaaS
— For dropdowns with "Geography/Location": select United States or North America
— For "How did you hear about us?": use "Website / Online Research"
— For "Referral": use "Direct Outreach"
— For any open text field about the company: use the full description above
— For "Anything else?" or "Additional comments": include the deck link and calendly link
— ALWAYS include the pitch deck link wherever there's a URL field: https://wask.docsend.com/view/6t5b4788rzun7ew7

STEP 4: SUBMIT
— Review all fields before submitting
— Ask the user for confirmation before clicking Submit
— After submission, note the confirmation message or any reference number

STEP 5: REPORT
After each website, report in this exact format:

FIRM: [Company Name]
WEBSITE: [URL visited]
FORM_URL: [URL of the form page]
FORM_TYPE: [Typeform / Google Form / Custom Form / Email Only / Airtable / Other]
STATUS: [Submitted / No Form Found / Email Only / CAPTCHA Blocked / Error / Skipped]
FIELDS_FILLED: [number of fields]
DECK_SENT: [Yes / No]
EMAIL_PROVIDED: [Yes / No]
TIMESTAMP: [current date and time]
NOTES: [any relevant details, confirmation messages, errors, or the email address if Email Only]

Then proceed to the next firm.

═══ HANDLING EDGE CASES ═══
• If a site is down or unreachable → Status: "Skipped", Note: "Website unreachable"
• If redirected to a different domain → follow only if it's clearly the same org
• If form has a file upload for deck → note it, skip the upload, paste the DocSend link instead
• If form asks for revenue range → select the bracket containing $2M (e.g., "$1M-$5M")
• If form asks for funding range → select the bracket containing $4M (e.g., "$1M-$5M")
• If asked about employee count → select bracket containing 25 (e.g., "11-50")
• If asked about valuation → $22.4M or the bracket containing it
• If asked about geography focus → "Global" or "North America, Europe"
• If form requires a pitch deck FILE upload → skip the upload, write the DocSend link in any text field available, note "File upload required" in report`;

const BATCH_1 = `Process these firms one by one. For each: navigate to the website, find the pitch/contact form, fill it with WASK info, and submit after my confirmation. Report results after each.

1. Grand Strand Angel Network — http://www.grandstrandangelnetwork.com
2. 757 Angels — http://www.757angelsgroup.com/
3. Accelerate Venture Partners — https://www.midwestventure.com
4. Accelerating Angels — https://acceleratingangels.com/
5. AccelHUB Venture Partners — https://www.accelhub.co/accelhub-venture-partners
6. Aggie Angel Network — http://aggieangelnetwork.com/
7. Alabama Capital Network — http://www.alabamacapitalnetwork.com
8. Alamo Angels — http://alamoangels.com/
9. Allen Angel Capital Education Program — https://business.missouri.edu/allen-angel-capital-education-program
10. Alliance of Angels — https://www.allianceofangels.com
11. American Sustainable Business Network — https://www.asbnetwork.org/investors-circle
12. Angel Forum Vancouver — https://www.angelforum.org
13. Angel Investor Forum — https://www.angelinvestorforum.com
14. Angel One Investor Network — https://www.angelonenetwork.ca
15. Angel Star Ventures — https://angelstarventures.com/
16. Angeles Investors — http://www.angelesinvestors.com
17. AngelList — https://www.angel.co
18. Anges Quebec — https://www.angesquebec.com
19. Appalachian Investors Alliance — https://appalachianinvestors.org/
20. Ariel Savannah Angel Partners — https://www.asap-invests.com

Start with firm #1.`;

const answers = {
  contact: [
    { label: "Full Name", value: "Utku Bozkurt" },
    { label: "Title", value: "Co-Founder & CSO" },
    { label: "Email", value: "investment@wask.co" },
    { label: "Mobile", value: "+44 7435583335" },
    { label: "LinkedIn", value: "linkedin.com/in/utku-bozkurtt/" },
    { label: "Calendly", value: "calendly.com/utku_bozkurt/intro-call" },
  ],
  company: [
    { label: "Company", value: "WASK Inc." },
    { label: "Website", value: "https://www.wask.co" },
    { label: "Founded", value: "2022 (U.S.)" },
    { label: "HQ", value: "Wilmington, DE, USA" },
    { label: "Entity", value: "Delaware C-Corp" },
    { label: "Employees", value: "25 full-time" },
    { label: "Industry", value: "Agentic AI AdTech" },
  ],
  fundraise: [
    { label: "Round", value: "Series A" },
    { label: "Amount", value: "$4,000,000" },
    { label: "Valuation", value: "$22.4M" },
    { label: "Secured", value: "60% (~$2.4M)" },
    { label: "Instrument", value: "SAFE" },
    { label: "Deck", value: "wask.docsend.com/view/6t5b4788rzun7ew7" },
    { label: "Data Room", value: "waskinc-dataroom.notion.site" },
    { label: "Stage Options", value: "Series A → Growth → Late-Seed" },
  ],
  metrics: [
    { label: "ARR", value: "$2.1M" },
    { label: "MRR", value: "$180K" },
    { label: "Cumulative Rev", value: "$6.8M" },
    { label: "Subscribers", value: "7,000+" },
    { label: "Countries", value: "130+" },
    { label: "LTV/CAC", value: "4.80x" },
    { label: "Monthly Churn", value: "4.21%" },
    { label: "Net Burn", value: "$150K/month" },
    { label: "Target", value: "$12M ARR by 2028" },
  ],
  dropdowns: [
    { field: "Stage", select: "Series A", alt: "Growth, Late-Seed" },
    { field: "Industry", select: "AdTech", alt: "Agentic AI, Marketing Tech, AI" },
    { field: "Location", select: "United States", alt: "North America, Global" },
    { field: "Revenue Range", select: "$1M - $5M", alt: "Bracket containing $2.1M" },
    { field: "Raising Amount", select: "$1M - $5M", alt: "Bracket containing $4M" },
    { field: "Employees", select: "11-50", alt: "Bracket containing 25" },
    { field: "Business Model", select: "SaaS / Subscription", alt: "B2B, Recurring Revenue" },
    { field: "How Heard?", select: "Website / Online Research", alt: "Direct Outreach" },
  ],
};

const steps = [
  { n: "1", title: "Initialize", desc: "Open Claude in Chrome. Paste the System Prompt (Tab 1). Then paste the Batch (Tab 1 bottom)." },
  { n: "2", title: "Navigate", desc: "Agent opens each VC website URL. Scans nav, hero, and footer for pitch/contact links." },
  { n: "3", title: "Locate Form", desc: "Identifies form type: custom, Typeform, Google Form, Airtable, or email-only." },
  { n: "4", title: "Fill Fields", desc: "Maps each field to the answer bank. Handles inputs, dropdowns, radios, textareas." },
  { n: "5", title: "Confirm", desc: "Shows summary of filled fields. Waits for your 'yes' before submitting." },
  { n: "6", title: "Submit", desc: "Clicks submit. Captures confirmation or error message." },
  { n: "7", title: "Report", desc: "Outputs structured report (firm, URL, status, fields, timestamp)." },
  { n: "8", title: "Next", desc: "Proceeds to next firm. Repeats until batch complete." },
];

const statuses = [
  { code: "Submitted", color: "#00e676", meaning: "Form filled & sent" },
  { code: "No Form Found", color: "#9e9e9e", meaning: "No pitch form on site" },
  { code: "Email Only", color: "#448aff", meaning: "Only email available" },
  { code: "CAPTCHA Blocked", color: "#ffd740", meaning: "Bot protection hit" },
  { code: "Account Required", color: "#ffd740", meaning: "Signup needed" },
  { code: "Error", color: "#ff5252", meaning: "Submission failed" },
  { code: "Skipped", color: "#9e9e9e", meaning: "Site down or irrelevant" },
];

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        padding: "8px 18px", borderRadius: 7, fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
        cursor: "pointer", border: "none", transition: "all 0.2s",
        background: copied ? "#ffd740" : "#00e676",
        color: "#0a0f0d",
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function AnswerCard({ icon, title, items }) {
  return (
    <div style={{ background: "#111916", border: "1px solid #1e3a2f", borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <span>{icon}</span> {title}
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ width: 130, flexShrink: 0, fontSize: 12, color: "#7cb694", fontWeight: 500 }}>{item.label}</div>
          <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#00e676" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("system");
  const tabs = [
    { id: "system", label: "System Prompt + Batch" },
    { id: "workflow", label: "Execution Workflow" },
    { id: "answers", label: "Answer Bank" },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0a0f0d", color: "#e8f5e9", minHeight: "100vh", padding: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 20, borderBottom: "1px solid #1e3a2f", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg, #00e676, #004d40)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 17, color: "#0a0f0d" }}>W</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>WASK VC Outreach Agent</div>
            <div style={{ fontSize: 12, color: "#7cb694", marginTop: 2 }}>Automated Investor Form Submission System</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", background: "rgba(0,230,118,0.1)", color: "#00e676", border: "1px solid rgba(0,230,118,0.2)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e676", animation: "pulse 2s infinite" }} /> Ready
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, background: "#111916", borderRadius: 12, padding: 4, marginBottom: 24, border: "1px solid #1e3a2f" }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: "pointer", transition: "all 0.2s", border: "none",
              fontFamily: "'DM Sans', sans-serif",
              color: tab === t.id ? "#0a0f0d" : "#7cb694",
              background: tab === t.id ? "#00e676" : "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB: SYSTEM PROMPT */}
      {tab === "system" && (
        <div>
          {/* Instructions */}
          <div style={{ background: "rgba(0,230,118,0.06)", border: "1px solid rgba(0,230,118,0.15)", borderRadius: 10, padding: "16px 20px", marginBottom: 20, fontSize: 13, lineHeight: 1.7 }}>
            <strong style={{ color: "#00e676" }}>How to use:</strong> Copy the System Prompt below → Open Claude in Chrome → Paste it as your first message → Then copy the Batch below and paste it as your second message → The agent will start processing.
          </div>

          {/* System Prompt */}
          <div style={{ background: "#111916", border: "1px solid #1e3a2f", borderRadius: 14, padding: 24, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>⚡ System Prompt</div>
              <CopyButton text={SYSTEM_PROMPT} label="Copy System Prompt" />
            </div>
            <div style={{ background: "#0a0f0d", border: "1px solid #1e3a2f", borderRadius: 10, padding: 20, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.8, color: "#7cb694", maxHeight: 400, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {SYSTEM_PROMPT}
            </div>
          </div>

          {/* Batch 1 */}
          <div style={{ background: "#111916", border: "1px solid #1e3a2f", borderRadius: 14, padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>📋 Batch 1 — Firms 1-20</div>
              <CopyButton text={BATCH_1} label="Copy Batch 1" />
            </div>
            <div style={{ background: "#0a0f0d", border: "1px solid #1e3a2f", borderRadius: 10, padding: 20, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.8, color: "#7cb694", maxHeight: 300, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {BATCH_1}
            </div>
          </div>
        </div>
      )}

      {/* TAB: WORKFLOW */}
      {tab === "workflow" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: "#111916", border: "1px solid #1e3a2f", borderRadius: 14, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🔄 Agent Execution Flow</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {steps.map(s => (
                <div key={s.n} style={{ display: "flex", gap: 14, padding: "12px 14px", background: "#0a0f0d", borderRadius: 8, border: "1px solid transparent" }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, background: "rgba(0,230,118,0.15)", color: "#00e676" }}>{s.n}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: "#7cb694", lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ background: "#111916", border: "1px solid #1e3a2f", borderRadius: 14, padding: 24, marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>📊 Status Codes</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", color: "#7cb694", borderBottom: "1px solid #1e3a2f" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", color: "#7cb694", borderBottom: "1px solid #1e3a2f" }}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {statuses.map(s => (
                    <tr key={s.code}>
                      <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: s.color, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{s.code}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12, color: "#7cb694", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{s.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ background: "#111916", border: "1px solid #1e3a2f", borderRadius: 14, padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🎯 Throughput</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "Per Session", val: "20-40", sub: "firms", color: "#00e676" },
                  { label: "Per Firm", val: "2-5m", sub: "avg time", color: "#448aff" },
                  { label: "All 646", val: "~20", sub: "sessions", color: "#ffd740" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#182420", borderRadius: 8, padding: 14, border: "1px solid #1e3a2f" }}>
                    <div style={{ fontSize: 10, color: "#7cb694", textTransform: "uppercase", letterSpacing: 0.5 }}>{m.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: m.color, marginTop: 4 }}>{m.val}</div>
                    <div style={{ fontSize: 10, color: "#7cb694", marginTop: 2 }}>{m.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: ANSWERS */}
      {tab === "answers" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <AnswerCard icon="👤" title="Contact Info" items={answers.contact} />
            <AnswerCard icon="🏢" title="Company Details" items={answers.company} />
            <AnswerCard icon="💰" title="Fundraise" items={answers.fundraise} />
            <AnswerCard icon="📊" title="Key Metrics" items={answers.metrics} />
          </div>

          <div style={{ background: "#111916", border: "1px solid #1e3a2f", borderRadius: 14, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>💬 Dropdown / Selection Mapping</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 10, textTransform: "uppercase", color: "#7cb694", borderBottom: "1px solid #1e3a2f", background: "#0a0f0d" }}>Form Field</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 10, textTransform: "uppercase", color: "#7cb694", borderBottom: "1px solid #1e3a2f", background: "#0a0f0d" }}>Select This</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 10, textTransform: "uppercase", color: "#7cb694", borderBottom: "1px solid #1e3a2f", background: "#0a0f0d" }}>Alternatives</th>
                </tr>
              </thead>
              <tbody>
                {answers.dropdowns.map(d => (
                  <tr key={d.field}>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#7cb694", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{d.field}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#00e676", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{d.select}</td>
                    <td style={{ padding: "10px 14px", fontSize: 11, color: "#7cb694", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{d.alt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}
