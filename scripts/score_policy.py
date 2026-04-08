#!/usr/bin/env python3
"""Shared score policy helpers used by ranking generation scripts."""

from __future__ import annotations


def round_score(value: float) -> float:
    return round(value * 10) / 10


def age_adjusted_score(base_score: float, age: int | None) -> float:
    """Apply the same age curve used by the frontend age-adjusted ranking."""
    if age is None:
        return round_score(base_score)

    peak_age = 23
    diff = abs(age - peak_age)

    if diff <= 3:
        adjustment = 5 - diff
    elif diff <= 10:
        adjustment = -(diff - 3) * 0.8
    else:
        adjustment = -5.6 - (diff - 10) * 1.2

    return round_score(base_score + adjustment)
