#!/usr/bin/env python3
import argparse
import json
import re
import time
import urllib.error
import urllib.request


SYSTEM_PROMPT = """You are a strict software review gate for an autonomous coding loop.
Return ONLY JSON with this schema:
{
  \"decision\": \"PASS\" | \"FAIL\",
  \"summary\": \"short reason\",
  \"blockers\": [\"...\"],
  \"required_fixes\": [\"...\"],
  \"risks\": [\"...\"]
}
Rules:
- Decide FAIL if the task/acceptance criteria are not fully satisfied.
- Decide FAIL for regression risk, missing validation, security issues, or incorrect architecture.
- Prefer concrete, actionable blockers.
- Keep output concise and deterministic.
"""


def parse_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_model(value: str) -> str:
    model = str(value or "").strip()
    if model.startswith("openrouter/"):
        model = model[len("openrouter/") :]
    return model


def to_list(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if value is None:
        return []
    text = str(value).strip()
    return [text] if text else []


def extract_json_block(text: str):
    raw = text.strip()
    if not raw:
        return None

    try:
        return json.loads(raw)
    except Exception:
        pass

    fenced = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.DOTALL).strip()
    if fenced:
        try:
            return json.loads(fenced)
        except Exception:
            pass

    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            return None

    return None


def call_review_once(api_key: str, endpoint: str, model: str, prompt: str, timeout_seconds: float):
    payload = {
        "model": normalize_model(model),
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    }

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://devfactory.local",
            "X-Title": "DevFactory Review Gate",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace").strip()
        except Exception:
            body = ""
        suffix = f" body={body[:600]}" if body else ""
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}{suffix}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc


def call_review_with_retry(
    api_key: str,
    endpoint: str,
    model: str,
    prompt: str,
    timeout_seconds: float,
    retries: int,
    retry_delay_seconds: float,
):
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            return call_review_once(api_key, endpoint, model, prompt, timeout_seconds), attempt
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(retry_delay_seconds)

    raise RuntimeError(f"review_api_error_after_{retries}_attempts: {last_exc}")


def extract_content(response: dict) -> str:
    try:
        content = response["choices"][0]["message"]["content"]
    except Exception as exc:
        raise ValueError(f"Malformed review response: {exc}") from exc

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                text = str(part.get("text", "")).strip()
                if text:
                    parts.append(text)
        return "\n".join(parts).strip()

    return str(content)


def normalize_decision(value: str) -> str:
    decision = str(value or "").strip().upper()
    if decision in {"APPROVED", "APPROVE", "ACCEPTED", "ACCEPT"}:
        return "PASS"
    if decision in {"REJECTED", "REJECT", "BLOCK", "BLOCKED"}:
        return "FAIL"
    return decision


def main() -> int:
    parser = argparse.ArgumentParser(description="Strict review gate using OpenRouter")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--endpoint", default="https://openrouter.ai/api/v1/chat/completions")
    parser.add_argument("--model", required=True)
    parser.add_argument("--task-name", required=True)
    parser.add_argument("--task-body-file", required=True)
    parser.add_argument("--diff-file", required=True)
    parser.add_argument("--fail-open", default="false")
    parser.add_argument("--fail-open-on-api-error", default="false")
    parser.add_argument("--api-retries", type=int, default=2)
    parser.add_argument("--api-retry-delay", type=float, default=1.5)
    parser.add_argument("--api-timeout", type=float, default=45)
    args = parser.parse_args()

    fail_open = parse_bool(args.fail_open)
    fail_open_on_api_error = parse_bool(args.fail_open_on_api_error)
    api_retries = max(1, int(args.api_retries))
    api_retry_delay = max(0.0, float(args.api_retry_delay))
    api_timeout = max(5.0, float(args.api_timeout))

    task_body = open(args.task_body_file, "r", encoding="utf-8").read()
    diff_text = open(args.diff_file, "r", encoding="utf-8").read()

    if not diff_text.strip():
        print(
            json.dumps(
                {
                    "decision": "PASS",
                    "summary": "No diff to review",
                    "blockers": [],
                    "required_fixes": [],
                    "risks": [],
                    "feedback": [],
                    "attempts": 0,
                }
            )
        )
        return 0

    prompt = f"""Task name:
{args.task_name}

Task requirements:
{task_body}

Git diff to review:
{diff_text}

Evaluate strictly against the task requirements and production safety.
Return JSON only.
"""

    try:
        response, attempts_used = call_review_with_retry(
            args.api_key,
            args.endpoint,
            args.model,
            prompt,
            api_timeout,
            api_retries,
            api_retry_delay,
        )
    except Exception as exc:
        if fail_open_on_api_error or fail_open:
            print(
                json.dumps(
                    {
                        "decision": "PASS",
                        "summary": f"Review API error but fail-open enabled: {exc}",
                        "blockers": [],
                        "required_fixes": [],
                        "risks": [f"review_api_error: {exc}"],
                        "feedback": [],
                        "attempts": api_retries,
                    }
                )
            )
            return 0

        print(
            json.dumps(
                {
                    "decision": "FAIL",
                    "summary": f"Review API error: {exc}",
                    "blockers": [f"review_api_error: {exc}"],
                    "required_fixes": ["Stabilize review gate API connectivity and retry"],
                    "risks": [],
                    "feedback": [f"review_api_error: {exc}"],
                    "attempts": api_retries,
                }
            )
        )
        return 1

    try:
        content = extract_content(response)
    except Exception as exc:
        if not fail_open:
            print(
                json.dumps(
                    {
                        "decision": "FAIL",
                        "summary": str(exc),
                        "blockers": ["review_response_malformed"],
                        "required_fixes": ["Retry review with stable model output"],
                        "risks": [],
                        "feedback": ["review_response_malformed"],
                        "attempts": attempts_used,
                    }
                )
            )
            return 1
        content = ""

    parsed = extract_json_block(content)
    if parsed is None:
        if fail_open:
            print(
                json.dumps(
                    {
                        "decision": "PASS",
                        "summary": "Reviewer returned non-JSON but fail-open enabled",
                        "blockers": [],
                        "required_fixes": [],
                        "risks": ["review_response_non_json"],
                        "feedback": [],
                        "attempts": attempts_used,
                    }
                )
            )
            return 0

        print(
            json.dumps(
                {
                    "decision": "FAIL",
                    "summary": "Reviewer returned non-JSON output",
                    "blockers": ["review_response_non_json"],
                    "required_fixes": ["Use a deterministic review model or adjust prompt"],
                    "risks": [],
                    "feedback": ["review_response_non_json"],
                    "attempts": attempts_used,
                }
            )
        )
        return 1

    decision = normalize_decision(parsed.get("decision", ""))
    summary = str(parsed.get("summary", "")).strip()
    blockers = to_list(parsed.get("blockers"))
    required_fixes = to_list(parsed.get("required_fixes"))
    risks = to_list(parsed.get("risks"))

    if decision not in {"PASS", "FAIL"}:
        decision = "FAIL"
        blockers.append("review_decision_invalid")
        required_fixes.append("Return decision as PASS or FAIL")
        if not summary:
            summary = "Reviewer output contained invalid decision"

    feedback = []
    for item in blockers + required_fixes:
        if item and item not in feedback:
            feedback.append(item)

    result = {
        "decision": decision,
        "summary": summary or ("Review passed" if decision == "PASS" else "Review failed"),
        "blockers": blockers,
        "required_fixes": required_fixes,
        "risks": risks,
        "feedback": feedback,
        "attempts": attempts_used,
    }
    print(json.dumps(result))
    return 0 if decision == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
