#!/usr/bin/env python3
import argparse
import json
import math
import sys
import urllib.error
import urllib.request


def parse_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def find_numeric(node, names):
    if isinstance(node, dict):
        for key, value in node.items():
            if key.lower() in names and isinstance(value, (int, float)) and not isinstance(value, bool):
                return float(value)
        for value in node.values():
            found = find_numeric(value, names)
            if found is not None:
                return found
    elif isinstance(node, list):
        for item in node:
            found = find_numeric(item, names)
            if found is not None:
                return found
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Check OpenRouter key budget guardrails")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--endpoint", default="https://openrouter.ai/api/v1/key")
    parser.add_argument("--min-remaining", type=float, default=1.0)
    parser.add_argument("--max-usage", type=float, default=0.0)
    parser.add_argument("--fail-open", default="true")
    args = parser.parse_args()

    fail_open = parse_bool(args.fail_open)

    request = urllib.request.Request(
        args.endpoint,
        headers={
            "Authorization": f"Bearer {args.api_key}",
            "Content-Type": "application/json",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        if fail_open:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "remaining": None,
                        "usage": None,
                        "limit": None,
                        "message": f"budget_check_error_fail_open: {exc}",
                    }
                )
            )
            return 0

        print(
            json.dumps(
                {
                    "ok": False,
                    "remaining": None,
                    "usage": None,
                    "limit": None,
                    "message": f"budget_check_error: {exc}",
                }
            )
        )
        return 1

    data = payload.get("data", payload)

    remaining = find_numeric(data, {"limit_remaining", "remaining", "remaining_credits", "credits_remaining"})
    usage = find_numeric(data, {"usage", "spent", "credits_used", "usage_usd", "cost"})
    limit = find_numeric(data, {"limit", "credit_limit", "hard_limit", "max_credits"})

    if remaining is None and usage is not None and limit is not None:
        remaining = max(limit - usage, 0.0)

    ok = True
    reasons = []

    if remaining is not None and remaining < args.min_remaining:
        ok = False
        reasons.append(f"remaining<{args.min_remaining:.2f}")

    if args.max_usage > 0 and usage is not None and usage > args.max_usage:
        ok = False
        reasons.append(f"usage>{args.max_usage:.2f}")

    result = {
        "ok": ok,
        "remaining": None if remaining is None else round(remaining, 4),
        "usage": None if usage is None else round(usage, 4),
        "limit": None if limit is None else round(limit, 4),
        "message": "ok" if ok else ";".join(reasons),
    }
    print(json.dumps(result))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
