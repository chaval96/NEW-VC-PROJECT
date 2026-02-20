import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { SubmissionRequest, SubmissionStatus } from "../domain/types.js";
import { buildPreSubmitScreenshotRelativePath, resolveEvidenceAbsolutePath } from "./execution-evidence.js";

export interface SubmissionExecutionResult {
  status: SubmissionStatus;
  note: string;
  blockedReason?: string;
  discoveredAt?: string;
  filledAt?: string;
  submittedAt?: string;
  executionMode: "simulated" | "automated";
  proofLevel: "none" | "pre_submit_screenshot" | "submitted_confirmation";
  preSubmitScreenshotPath?: string;
  preSubmitScreenshotCapturedAt?: string;
  submittedVerified?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

const require = createRequire(import.meta.url);
const fallbackPlaywrightPath = process.env.PLAYWRIGHT_GLOBAL_MODULE_PATH?.trim() || "/usr/local/lib/node_modules/playwright";
const playwrightPackageName = process.env.PLAYWRIGHT_PACKAGE_NAME?.trim() || "playwright";

async function loadPlaywright(): Promise<any | undefined> {
  try {
    const local = await import(playwrightPackageName);
    return local;
  } catch {
    try {
      return require(fallbackPlaywrightPath);
    } catch {
      return undefined;
    }
  }
}

interface ExecutionOptions {
  attempt: number;
}

export async function executeSubmissionRequest(
  request: SubmissionRequest,
  options: ExecutionOptions
): Promise<SubmissionExecutionResult> {
  const enablePlaywright = process.env.PLAYWRIGHT_ENABLED === "true";
  const enableSubmit = process.env.PLAYWRIGHT_SUBMIT_ENABLED === "true";

  if (!enablePlaywright) {
    return {
      status: request.mode === "dry_run" ? "form_filled" : "needs_review",
      note: "Playwright is disabled. No live browser execution was performed.",
      discoveredAt: request.mode === "dry_run" ? nowIso() : undefined,
      filledAt: request.mode === "dry_run" ? nowIso() : undefined,
      executionMode: "simulated",
      proofLevel: "none",
      submittedVerified: false
    };
  }

  try {
    const playwright = await loadPlaywright();
    if (!playwright?.chromium?.launch) {
      return {
        status: request.mode === "dry_run" ? "form_filled" : "needs_review",
        note: "Playwright runtime not found in this environment. No live browser execution was performed.",
        discoveredAt: request.mode === "dry_run" ? nowIso() : undefined,
        filledAt: request.mode === "dry_run" ? nowIso() : undefined,
        executionMode: "simulated",
        proofLevel: "none",
        submittedVerified: false
      };
    }

    const browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
    const page = await browser.newPage();

    await page.goto(request.website, { waitUntil: "domcontentloaded", timeout: 30000 });

    const pageText = (await page.content()).toLowerCase();
    if (pageText.includes("captcha") || pageText.includes("i am not a robot")) {
      await browser.close();
      return {
        status: "blocked",
        note: "CAPTCHA detected during submission attempt.",
        blockedReason: "CAPTCHA Blocked",
        executionMode: "automated",
        proofLevel: "none",
        submittedVerified: false
      };
    }

    const form = await page.$("form");
    if (!form) {
      await browser.close();
      return {
        status: "no_form_found",
        note: "No form element found on target page.",
        executionMode: "automated",
        proofLevel: "none",
        submittedVerified: false
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
    let preSubmitScreenshotPath: string | undefined;
    let preSubmitScreenshotCapturedAt: string | undefined;

    try {
      const relativePath = buildPreSubmitScreenshotRelativePath(request.workspaceId, request.id, options.attempt);
      const absolutePath = resolveEvidenceAbsolutePath(relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await page.screenshot({ path: absolutePath, fullPage: true });
      preSubmitScreenshotPath = relativePath;
      preSubmitScreenshotCapturedAt = nowIso();
    } catch {
      preSubmitScreenshotPath = undefined;
      preSubmitScreenshotCapturedAt = undefined;
    }

    if (!enableSubmit) {
      await browser.close();
      const proofLevel = preSubmitScreenshotPath ? "pre_submit_screenshot" : "none";
      return {
        status: request.mode === "dry_run" ? "form_filled" : "needs_review",
        note:
          request.mode === "dry_run"
            ? "Form filled in dry-run mode with pre-submit evidence."
            : "Form filled, but submit action is disabled. Requires manual review.",
        discoveredAt,
        filledAt,
        executionMode: "automated",
        proofLevel,
        preSubmitScreenshotPath,
        preSubmitScreenshotCapturedAt,
        submittedVerified: false
      };
    }

    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (!submitButton) {
      await browser.close();
      const proofLevel = preSubmitScreenshotPath ? "pre_submit_screenshot" : "none";
      return {
        status: "needs_review",
        note: "Form found and filled, but no submit button located.",
        discoveredAt,
        filledAt,
        executionMode: "automated",
        proofLevel,
        preSubmitScreenshotPath,
        preSubmitScreenshotCapturedAt,
        submittedVerified: false
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
        submittedAt: nowIso(),
        executionMode: "automated",
        proofLevel: "submitted_confirmation",
        preSubmitScreenshotPath,
        preSubmitScreenshotCapturedAt,
        submittedVerified: true
      };
    }

    const proofLevel = preSubmitScreenshotPath ? "pre_submit_screenshot" : "none";
    return {
      status: "needs_review",
      note: "Submit clicked but success confirmation not detected. Requires manual check.",
      discoveredAt,
      filledAt,
      executionMode: "automated",
      proofLevel,
      preSubmitScreenshotPath,
      preSubmitScreenshotCapturedAt,
      submittedVerified: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown submission error";
    if (message.toLowerCase().includes("cannot find package") || message.toLowerCase().includes("cannot find module")) {
      return {
        status: request.mode === "dry_run" ? "form_filled" : "needs_review",
        note: "Playwright package is not installed in this environment. No live submission was executed.",
        discoveredAt: request.mode === "dry_run" ? nowIso() : undefined,
        filledAt: request.mode === "dry_run" ? nowIso() : undefined,
        executionMode: "simulated",
        proofLevel: "none",
        submittedVerified: false
      };
    }

    return {
      status: "errored",
      note: `Submission execution failed: ${message}`,
      executionMode: "automated",
      proofLevel: "none",
      submittedVerified: false
    };
  }
}
