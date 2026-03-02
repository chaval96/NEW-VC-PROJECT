#!/usr/bin/env python3
import argparse
import json
import re
import sys
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

    # exact JSON
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        pass

    # fenced JSON
    fenced = re.sub(r"^```(?:json)?\\s*|\\s*```$", "", raw, flags=re.IGNORECASE | re.DOTALL).strip()
    if fenced:
        try:
            return json.loads(fenced)
        except Exception:  # noqa: BLE001
            pass

    # first object-like block
    match = re.search(r"\\{[\\s\\S]*\\}", raw)
    if match:
        candidate = match.group(0)
        try:
            return json.loads(candidate)
        except Exception:  # noqa: BLE001
            return None

    return None


def call_review(api_key: str, endpoint: str, model: str, prompt: str):
    payload = {
        "model": model,
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

    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Strict review gate using OpenRouter")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--endpoint", default="https://openrouter.ai/api/v1/chat/completions")
    parser.add_argument("--model", required=True)
    parser.add_argument("--task-name", required=True)
    parser.add_argument("--task-body-file", required=True)
    parser.add_argument("--diff-file", required=True)
    parser.add_argument("--fail-open", default="false")
    args = parser.parse_args()

    fail_open = parse_bool(args.fail_open)

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
        response = call_review(args.api_key, args.endpoint, args.model, prompt)
    except Exception as exc:  # noqa: BLE001
        if fail_open:
            print(
                json.dumps(
                    {
                        "decision": "PASS",
                        "summary": f"Review API error but fail-open enabled: {exc}",
                        "blockers": [],
                        "required_fixes": [],
                        "risks": [f"review_api_error: {exc}"],
                        "feedback": [],
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
                }
            )
        )
        return 1

    try:
        content = response["choices"][0]["message"]["content"]
    except Exception as exc:  # noqa: BLE001
        content = ""
        if not fail_open:
            print(
                json.dumps(
                    {
                        "decision": "FAIL",
                        "summary": f"Malformed review response: {exc}",
                        "blockers": ["review_response_malformed"],
                        "required_fixes": ["Retry review with stable model output"],
                        "risks": [],
                        "feedback": ["review_response_malformed"],
                    }
                )
            )
            return 1

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
                }
            )
        )
        return 1

    decision = str(parsed.get("decision", "")).strip().upper()
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
    }
    print(json.dumps(result))
    return 0 if decision == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
