#!/usr/bin/env python3
"""Distribution-based helpers for per-metric normalization."""

from __future__ import annotations

import math
import statistics
from typing import Mapping, Sequence

METRIC_KEYS = ("golden_ratio", "eyes", "nose", "mouth")
METRIC_WEIGHTS = {
    "golden_ratio": 0.40,
    "eyes": 0.20,
    "nose": 0.20,
    "mouth": 0.20,
}
DEVIATION_MIN = 20.0
DEVIATION_MAX = 80.0


def round_score(value: float) -> float:
    return round(value * 10) / 10


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def percentile(sorted_values: Sequence[float], ratio: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]

    index = (len(sorted_values) - 1) * ratio
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return sorted_values[lower]

    lower_weight = upper - index
    upper_weight = index - lower
    return sorted_values[lower] * lower_weight + sorted_values[upper] * upper_weight


def _extract_metric_values(entries: Sequence[Mapping], metric: str) -> list[float]:
    values: list[float] = []
    for entry in entries:
        details = entry.get("details") if isinstance(entry, Mapping) else None
        if not isinstance(details, Mapping):
            continue
        value = details.get(metric)
        if isinstance(value, (int, float)):
            values.append(float(value))
    return values


def compute_metric_stats(entries: Sequence[Mapping]) -> dict[str, dict[str, float]]:
    stats: dict[str, dict[str, float]] = {}

    for metric in METRIC_KEYS:
        values = _extract_metric_values(entries, metric)
        if not values:
            stats[metric] = {
                "count": 0.0,
                "min": 0.0,
                "max": 0.0,
                "mean": 50.0,
                "median": 50.0,
                "stdev": 0.0,
                "p10": 0.0,
                "p90": 0.0,
                "skew": 0.0,
            }
            continue

        ordered = sorted(values)
        mean = sum(values) / len(values)
        stdev = statistics.pstdev(values) if len(values) > 1 else 0.0
        if stdev > 0:
            skew = sum(((value - mean) / stdev) ** 3 for value in values) / len(values)
        else:
            skew = 0.0

        stats[metric] = {
            "count": float(len(values)),
            "min": ordered[0],
            "max": ordered[-1],
            "mean": mean,
            "median": statistics.median(values),
            "stdev": stdev,
            "p10": percentile(ordered, 0.10),
            "p90": percentile(ordered, 0.90),
            "skew": skew,
        }

    return stats


def metric_deviation_score(
    value: float | int | None,
    stat: Mapping[str, float] | None,
    low: float = DEVIATION_MIN,
    high: float = DEVIATION_MAX,
) -> float:
    if value is None or stat is None:
        return 50.0

    mean = float(stat.get("mean", 50.0))
    stdev = float(stat.get("stdev", 0.0))
    if stdev <= 0:
        return 50.0

    score = 50 + 10 * ((float(value) - mean) / stdev)
    return round_score(clamp(score, low, high))


def adjusted_overall_score(
    details: Mapping[str, float | int] | None,
    stats: Mapping[str, Mapping[str, float]],
) -> float:
    if not isinstance(details, Mapping):
        return 50.0

    total = 0.0
    for metric in METRIC_KEYS:
        total += metric_deviation_score(details.get(metric), stats.get(metric)) * METRIC_WEIGHTS[metric]
    return round_score(total)


def apply_distribution_adjusted_scores(entries: Sequence[dict]) -> dict[str, dict[str, float]]:
    stats = compute_metric_stats(entries)
    for entry in entries:
        entry["score"] = adjusted_overall_score(entry.get("details"), stats)
    return stats
