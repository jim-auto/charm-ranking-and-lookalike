#!/usr/bin/env python3
"""scoring.py - Canonical face-scoring math shared by every offline pipeline.

This is the single source of truth for the geometric scoring used to generate
web/public/data/celebrities.json. It operates on 68 landmarks in the classic
dlib/face-api ordering (chin 0-16, brows 17-26, nose 27-35, eyes 36-47,
lips 48-67), regardless of whether those points came from face_recognition
(dlib) or from MediaPipe remapped to the 68-point layout.

IMPORTANT: web/src/lib/faceMetricCalculator.ts MUST mirror these formulas
exactly, otherwise a diagnosed user's metrics are not comparable to the
celebrity distribution. If you change a formula or an ideal ratio here, change
it there too.

Only golden_ratio, eyes, nose and mouth feed the final (distribution-adjusted)
overall score; symmetry and contour are computed for the radar display only.
See scripts/metric_distribution.py for the overall-score aggregation.
"""

from __future__ import annotations

import math
from typing import List, Tuple

GOLDEN_RATIO = 1.618

Point = Tuple[float, float]

# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def dist(a: Point, b: Point) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def midpoint(a: Point, b: Point) -> Point:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def average_point(points: List[Point]) -> Point:
    total_x = sum(point[0] for point in points)
    total_y = sum(point[1] for point in points)
    return (total_x / len(points), total_y / len(points))


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def calibrate_contour_raw_score(score: float) -> float:
    return clamp((score - 50.0) * 1.15 + 40.0)


def ratio_score(actual: float, ideal: float) -> float:
    deviation = abs(actual - ideal) / ideal
    return clamp((1 - deviation * 2) * 100)


def shape_ratio_score(actual: float, ideal: float, factor: float = 2.0) -> float:
    if actual <= 0 or ideal <= 0:
        return 0.0
    deviation = abs(actual - ideal) / ideal
    return clamp((1 - deviation * factor) * 100)


def polyline_length(points: List[Point]) -> float:
    if len(points) < 2:
        return 0.0
    return sum(dist(points[i], points[i + 1]) for i in range(len(points) - 1))


SYMMETRY_AXIS_INDICES = (27, 28, 29, 30, 51, 57, 8)
CONTOUR_AXIS_INDICES = (27, 28, 29, 30, 33, 51, 57, 8)
SYMMETRY_PAIRS: Tuple[Tuple[int, int, float], ...] = (
    (1, 15, 0.8),
    (2, 14, 0.9),
    (3, 13, 1.0),
    (4, 12, 1.0),
    (5, 11, 1.0),
    (6, 10, 0.9),
    (7, 9, 0.8),
    (17, 26, 0.8),
    (18, 25, 0.9),
    (19, 24, 1.0),
    (20, 23, 0.9),
    (21, 22, 0.8),
    (36, 45, 1.4),
    (37, 44, 1.2),
    (38, 43, 1.2),
    (39, 42, 1.1),
    (40, 47, 1.1),
    (41, 46, 1.1),
    (31, 35, 1.0),
    (32, 34, 1.0),
    (48, 54, 1.1),
    (49, 53, 1.0),
    (50, 52, 0.9),
    (59, 55, 0.9),
    (58, 56, 0.9),
    (60, 64, 1.0),
    (61, 63, 0.9),
    (67, 65, 0.8),
)


def rotate_point(point: Point, origin: Point, angle: float) -> Point:
    sin_a = math.sin(angle)
    cos_a = math.cos(angle)
    dx = point[0] - origin[0]
    dy = point[1] - origin[1]
    return (
        origin[0] + dx * cos_a - dy * sin_a,
        origin[1] + dx * sin_a + dy * cos_a,
    )


def rotate_landmarks(lm: List[Point]) -> List[Point]:
    left_eye = midpoint(lm[36], lm[39])
    right_eye = midpoint(lm[42], lm[45])
    eye_center = midpoint(left_eye, right_eye)
    roll = -math.atan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0])
    return [rotate_point(point, eye_center, roll) for point in lm]


def calculate_polyline_smoothness(points: List[Point]) -> float:
    if len(points) < 3:
        return 0.0

    smoothness = 0.0
    for i in range(1, len(points) - 1):
        expected = midpoint(points[i - 1], points[i + 1])
        deviation = dist(points[i], expected)
        segment_len = dist(points[i - 1], points[i + 1])
        smoothness += (deviation / segment_len) if segment_len > 0 else 0.0
    return smoothness / (len(points) - 2)


# ---------------------------------------------------------------------------
# Per-metric scoring
# ---------------------------------------------------------------------------

def calculate_golden_ratio(lm: List[Point]) -> float:
    jaw_left, jaw_right, chin = lm[0], lm[16], lm[8]
    forehead = lm[27]
    fw = dist(jaw_left, jaw_right)
    fh = dist(forehead, chin) * 1.3
    face_ratio = fh / fw if fw > 0 else 0
    le = midpoint(lm[36], lm[39])
    re = midpoint(lm[42], lm[45])
    eye_dist = dist(le, re)
    eye_ratio = eye_dist / fw if fw > 0 else 0
    return (ratio_score(face_ratio, 1.46) + ratio_score(eye_ratio, 1 / GOLDEN_RATIO)) / 2


def calculate_symmetry(lm: List[Point], face_width: float) -> float:
    if face_width <= 0:
        return 0.0

    rotated = rotate_landmarks(lm)

    face_height = dist(rotated[27], rotated[8]) * 1.3
    if face_height <= 0:
        return 0.0

    axis_x = sum(rotated[index][0] for index in SYMMETRY_AXIS_INDICES) / len(SYMMETRY_AXIS_INDICES)

    total_error = 0.0
    total_weight = 0.0
    for left_idx, right_idx, weight in SYMMETRY_PAIRS:
        left = rotated[left_idx]
        right = rotated[right_idx]
        x_error = abs((axis_x - left[0]) - (right[0] - axis_x)) / face_width
        y_error = abs(left[1] - right[1]) / face_height
        total_error += (x_error + y_error * 0.6) * weight
        total_weight += weight

    avg_error = total_error / total_weight if total_weight > 0 else 0.0
    return clamp((1 - avg_error * 2.8) * 100)


def calculate_eye_score(lm: List[Point]) -> float:
    lw = dist(lm[36], lm[39])
    lh = dist(lm[37], lm[41])
    rw = dist(lm[42], lm[45])
    rh = dist(lm[43], lm[47])
    lr = lh / lw if lw > 0 else 0
    rr = rh / rw if rw > 0 else 0
    avg_r = (lr + rr) / 2
    avg_w = (lw + rw) / 2
    bal = 1 - abs(lw - rw) / avg_w if avg_w > 0 else 0
    return clamp(ratio_score(avg_r, 0.33) * 0.6 + bal * 100 * 0.4)


def calculate_nose_score(lm: List[Point]) -> float:
    fw = dist(lm[0], lm[16])
    nw = dist(lm[31], lm[35])
    nl = dist(lm[27], lm[30])
    fh = dist(lm[27], lm[8]) * 1.3
    wr = ratio_score(nw / fw, 0.26) if fw > 0 else 0
    lr = ratio_score(nl / fh, 0.33) if fh > 0 else 0
    return (wr + lr) / 2


def calculate_mouth_score(lm: List[Point]) -> float:
    # Normalized by nose width (not face width). Mirrors
    # web/src/lib/faceMetricCalculator.ts:calculateMouthScore.
    mw = dist(lm[48], lm[54])
    nw = dist(lm[31], lm[35])
    ulh = dist(lm[51], lm[62])
    llh = dist(lm[57], lm[66])
    wr = ratio_score(mw / nw, 1.5) if nw > 0 else 0
    lr = ratio_score(ulh / llh, 0.8) if llh > 0 else 0
    return (wr + lr) / 2


def calculate_contour_score(lm: List[Point]) -> float:
    rotated = rotate_landmarks(lm)
    face_width = dist(rotated[0], rotated[16])
    face_height = dist(rotated[27], rotated[8]) * 1.3
    if face_width <= 0 or face_height <= 0:
        return 0.0

    axis_x = average_point([rotated[index] for index in CONTOUR_AXIS_INDICES])[0]
    upper_jaw_width = (axis_x - rotated[3][0]) + (rotated[13][0] - axis_x)
    mid_jaw_width = (axis_x - rotated[5][0]) + (rotated[11][0] - axis_x)
    chin_width = (axis_x - rotated[7][0]) + (rotated[9][0] - axis_x)
    chin_depth = dist(midpoint(rotated[5], rotated[11]), rotated[8])

    left_jaw_line = rotated[3:9]
    right_jaw_line = list(reversed(rotated[8:14]))
    left_curve_ratio = (
        polyline_length(left_jaw_line) / dist(left_jaw_line[0], left_jaw_line[-1])
        if dist(left_jaw_line[0], left_jaw_line[-1]) > 0
        else 0.0
    )
    right_curve_ratio = (
        polyline_length(right_jaw_line) / dist(right_jaw_line[0], right_jaw_line[-1])
        if dist(right_jaw_line[0], right_jaw_line[-1]) > 0
        else 0.0
    )
    curve_score = (
        shape_ratio_score(left_curve_ratio, 1.12, 2.2)
        + shape_ratio_score(right_curve_ratio, 1.12, 2.2)
    ) / 2
    avg = (
        calculate_polyline_smoothness(left_jaw_line)
        + calculate_polyline_smoothness(right_jaw_line)
    ) / 2

    upper_width_score = shape_ratio_score(upper_jaw_width / face_width, 0.72)
    taper_score = shape_ratio_score(mid_jaw_width / upper_jaw_width, 0.65) if upper_jaw_width > 0 else 0.0
    chin_width_score = shape_ratio_score(chin_width / mid_jaw_width, 0.32) if mid_jaw_width > 0 else 0.0
    chin_depth_score = shape_ratio_score(chin_depth / face_height, 0.065, 1.8)
    smoothness_score = clamp((1 - avg * 5.5) * 100)

    raw_score = (
        upper_width_score * 0.18
        + taper_score * 0.24
        + chin_width_score * 0.22
        + chin_depth_score * 0.18
        + curve_score * 0.10
        + smoothness_score * 0.08
    )
    return calibrate_contour_raw_score(raw_score)


def calculate_face_details(lm: List[Point]) -> dict:
    """Return the six per-metric scores as stored in celebrities.json.

    Only golden_ratio/eyes/nose/mouth feed the distribution-adjusted overall
    score (see metric_distribution.py); symmetry/contour are radar-only.
    """
    face_width = dist(lm[0], lm[16])
    return {
        "symmetry": round(calculate_symmetry(lm, face_width)),
        "golden_ratio": round(calculate_golden_ratio(lm)),
        "eyes": round(calculate_eye_score(lm)),
        "nose": round(calculate_nose_score(lm)),
        "mouth": round(calculate_mouth_score(lm)),
        "contour": round(calculate_contour_score(lm)),
    }
