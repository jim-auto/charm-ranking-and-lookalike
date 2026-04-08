from __future__ import annotations

import statistics
from collections import defaultdict

UNWANTED_TOP_CATEGORIES = {"comedian", "athlete", "sumo", "cultural"}
LOW_DEVIATION_CATEGORIES = {"actor", "actress", "idol"}
TOP_LIMIT = 50
LOW_DEVIATION_THRESHOLD = 40.0


def deviation(score: float, mean: float, stdev: float) -> float:
    if stdev == 0:
        return 50.0
    return 50 + 10 * (score - mean) / stdev


def compute_stats(celebrities: list[dict]) -> tuple[float, float]:
    scores = [entry.get("score", 0.0) for entry in celebrities]
    if not scores:
        return 0.0, 0.0
    mean = statistics.mean(scores)
    stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0
    return mean, stdev


def build_ranking_policy(celebrities: list[dict]) -> tuple[dict[str, dict], dict[str, float]]:
    mean, stdev = compute_stats(celebrities)
    sorted_by_score = sorted(celebrities, key=lambda entry: entry.get("score", 0.0), reverse=True)
    reasons_by_name: dict[str, list[str]] = defaultdict(list)

    survivors = 0
    for entry in sorted_by_score:
        category = entry.get("category")
        if category in UNWANTED_TOP_CATEGORIES:
            reasons_by_name[entry["name"]].append(
                f"おすすめ表示では除外: {category} は写真バイアスで上位に来やすいカテゴリ"
            )
            continue
        survivors += 1
        if survivors >= TOP_LIMIT:
            break

    for entry in sorted_by_score:
        category = entry.get("category")
        if category not in LOW_DEVIATION_CATEGORIES:
            continue
        dev = deviation(entry.get("score", 0.0), mean, stdev)
        if dev > LOW_DEVIATION_THRESHOLD:
            continue
        reasons_by_name[entry["name"]].append(
            f"おすすめ表示では除外: 偏差値 {dev:.1f} のため写真品質を要確認"
        )

    policy_by_name: dict[str, dict] = {}
    for entry in celebrities:
        reasons = reasons_by_name.get(entry["name"], [])
        policy_by_name[entry["name"]] = {
            "rankingEligible": not reasons,
            "rankingExclusionReasons": reasons,
        }

    return policy_by_name, {"mean": mean, "stdev": stdev}
