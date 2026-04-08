from __future__ import annotations

import statistics
from collections import defaultdict

UNWANTED_RECOMMENDED_CATEGORIES = {"athlete", "sumo", "prowrestler"}
LOW_DEVIATION_CATEGORIES = {"actor", "actress", "idol"}
LOW_DEVIATION_THRESHOLD = 40.0
FACE_VALIDATION_EXCLUSION_REASON = "invalid face geometry"


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
    reasons_by_name: dict[str, list[str]] = defaultdict(list)

    for entry in celebrities:
        if entry.get("faceValidationStatus") == "rejected":
            reasons_by_name[entry["name"]].append(FACE_VALIDATION_EXCLUSION_REASON)

    for entry in celebrities:
        category = entry.get("category")
        if category in UNWANTED_RECOMMENDED_CATEGORIES:
            reasons_by_name[entry["name"]].append(
                f"おすすめ表示では {category} カテゴリを除外"
            )

    for entry in celebrities:
        category = entry.get("category")
        if category not in LOW_DEVIATION_CATEGORIES:
            continue
        dev = deviation(entry.get("score", 0.0), mean, stdev)
        if dev > LOW_DEVIATION_THRESHOLD:
            continue
        reasons_by_name[entry["name"]].append(
            f"おすすめ表示では偏差値 {dev:.1f} が低いため除外"
        )

    policy_by_name: dict[str, dict] = {}
    for entry in celebrities:
        reasons = reasons_by_name.get(entry["name"], [])
        policy_by_name[entry["name"]] = {
            "rankingEligible": not reasons,
            "rankingExclusionReasons": reasons,
        }

    return policy_by_name, {"mean": mean, "stdev": stdev}
