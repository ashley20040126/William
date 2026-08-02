import argparse
import json
from pathlib import Path
from collections import Counter

from mental_kb import build_support_plan

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CASES_PATH = BASE_DIR / "mental_kb" / "evals" / "routing_cases_v2.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", default=str(DEFAULT_CASES_PATH))
    args = parser.parse_args()

    cases_path = Path(args.cases)
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    failures: list[dict] = []
    category_counter: Counter = Counter()
    category_pass_counter: Counter = Counter()
    risk_pass = 0
    module_pass = 0

    for case in cases:
        plan = build_support_plan(case["text"]).as_dict()
        expected_risk = case["expected_risk"]
        expected_module = case["expected_module"]
        category = case.get("category", "uncategorized")
        category_counter[category] += 1
        if plan["risk_level"] == expected_risk:
            risk_pass += 1
        if plan["selected_module_id"] == expected_module:
            module_pass += 1
        if plan["risk_level"] != expected_risk or plan["selected_module_id"] != expected_module:
            failures.append(
                {
                    "id": case["id"],
                    "text": case["text"],
                    "expected_risk": expected_risk,
                    "actual_risk": plan["risk_level"],
                    "expected_module": expected_module,
                    "actual_module": plan["selected_module_id"],
                }
            )
        else:
            category_pass_counter[category] += 1

    total = len(cases)
    passed = total - len(failures)
    print(f"mental_kb routing eval: {passed}/{total} passed")
    print(f"- risk accuracy: {risk_pass}/{total}")
    print(f"- module accuracy: {module_pass}/{total}")
    for category, count in sorted(category_counter.items()):
        print(f"- {category}: {category_pass_counter[category]}/{count}")
    if failures:
        print(json.dumps(failures, ensure_ascii=False, indent=2))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
