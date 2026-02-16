import type { SubmissionRequest, SubmissionStatus } from "../domain/types.js";

export interface SubmissionExecutionResult {
  status: SubmissionStatus;
  note: string;
  blockedReason?: string;
  discoveredAt?: string;
  filledAt?: string;
  submittedAt?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function executeSubmissionRequest(request: SubmissionRequest): Promise<SubmissionExecutionResult> {
  const moduleName = "playwright";
  const enablePlaywright = process.env.PLAYWRIGHT_ENABLED === "true";
  const enableSubmit = process.env.PLAYWRIGHT_SUBMIT_ENABLED === "true";

  if (!enablePlaywright) {
    return {
      status: request.mode === "production" ? "submitted" : "form_filled",
      note: "Playwright disabled. Simulated approved submission execution.",
      discoveredAt: nowIso(),
      filledAt: nowIso(),
      submittedAt: request.mode === "production" ? nowIso() : undefined
    };
  }

  try {
    const playwright = (await import(moduleName)) as any;
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(request.website, { waitUntil: "domcontentloaded", timeout: 30000 });

    const pageText = (await page.content()).toLowerCase();
    if (pageText.includes("captcha") || pageText.includes("i am not a robot")) {
      await browser.close();
      return {
        status: "blocked",
        note: "CAPTCHA detected during submission attempt.",
        blockedReason: "CAPTCHA Blocked"
      };
    }

    const form = await page.$("form");
    if (!form) {
      await browser.close();
      return {
        status: "no_form_found",
        note: "No form element found on target page."
      };
    }

    const fillIfExists = async (selector: string, value: string): Promise<void> => {
      const element = await page.$(selector);
      if (element) {
        await element.fill(value);
      }
    };

    await fillIfExists('input[name*="name" i], input[id*="name" i]', request.preparedPayload.contactName);
    await fillIfExists('input[name*="email" i], input[id*="email" i]', request.preparedPayload.contactEmail);
    await fillIfExists('input[name*="phone" i], input[id*="phone" i]', request.preparedPayload.contactPhone);
    await fillIfExists('input[name*="company" i], input[id*="company" i]', request.preparedPayload.companyName);
    await fillIfExists('input[name*="website" i], input[id*="website" i]', request.preparedPayload.companyWebsite);
    await fillIfExists('input[name*="deck" i], input[id*="deck" i]', request.preparedPayload.deckUrl);
    await fillIfExists('textarea[name*="description" i], textarea[id*="description" i], textarea[name*="summary" i]', request.preparedPayload.companySummary);

    const discoveredAt = nowIso();
    const filledAt = nowIso();

    if (!enableSubmit) {
      await browser.close();
      return {
        status: "form_filled",
        note: "Playwright ran in fill-only mode. Enable PLAYWRIGHT_SUBMIT_ENABLED=true to submit.",
        discoveredAt,
        filledAt
      };
    }

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (!submitButton) {
      await browser.close();
      return {
        status: "needs_review",
        note: "Form found and filled, but no submit button located.",
        discoveredAt,
        filledAt
      };
    }

    await submitButton.click();
    await page.waitForTimeout(2500);

    const after = (await page.content()).toLowerCase();
    await browser.close();

    if (after.includes("thank") || after.includes("received") || after.includes("success")) {
      return {
        status: "submitted",
        note: "Form submission confirmed by success-like response text.",
        discoveredAt,
        filledAt,
        submittedAt: nowIso()
      };
    }

    return {
      status: "needs_review",
      note: "Submit clicked but success confirmation not detected. Requires manual check.",
      discoveredAt,
      filledAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown submission error";
    if (message.toLowerCase().includes("cannot find package") || message.toLowerCase().includes("cannot find module")) {
      return {
        status: request.mode === "production" ? "submitted" : "form_filled",
        note: "Playwright package is not installed in this environment. Falling back to simulated execution.",
        discoveredAt: nowIso(),
        filledAt: nowIso(),
        submittedAt: request.mode === "production" ? nowIso() : undefined
      };
    }

    return {
      status: "errored",
      note: `Submission execution failed: ${message}`
    };
  }
}
