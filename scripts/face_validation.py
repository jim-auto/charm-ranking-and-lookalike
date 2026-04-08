from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence, Tuple

Point = Tuple[float, float]


@dataclass(frozen=True)
class FaceValidationResult:
    valid: bool
    reason: str
    metrics: dict[str, float]


def _dist(a: Point, b: Point) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _midpoint(a: Point, b: Point) -> Point:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _metric_between(metrics: Mapping[str, float], key: str, lo: float, hi: float) -> bool:
    value = metrics.get(key)
    return value is not None and lo <= value <= hi


def validate_human_face_landmarks(
    landmarks: Sequence[Point],
    *,
    image_size: Tuple[int, int] | None = None,
) -> FaceValidationResult:
    """
    Reject obvious non-human / broken detections using facial geometry.

    The checks intentionally focus on feature layout:
    - left/right eyes must be balanced and above the nose
    - nose must sit near face center
    - mouth must be below the nose and within a plausible width range
    - overall face occupancy should not be tiny when image size is known
    """
    if len(landmarks) < 68:
        return FaceValidationResult(False, "insufficient_landmarks", {"landmark_count": float(len(landmarks))})

    jaw_left = landmarks[0]
    jaw_right = landmarks[16]
    chin = landmarks[8]
    nose_top = landmarks[27]
    nose_tip = landmarks[30]
    nose_left = landmarks[31]
    nose_right = landmarks[35]
    mouth_left = landmarks[48]
    mouth_right = landmarks[54]
    upper_lip = landmarks[51]
    lower_lip = landmarks[57]
    left_eye = _midpoint(landmarks[36], landmarks[39])
    right_eye = _midpoint(landmarks[42], landmarks[45])

    face_width = _dist(jaw_left, jaw_right)
    face_height = _dist(nose_top, chin) * 1.3
    left_eye_width = _dist(landmarks[36], landmarks[39])
    right_eye_width = _dist(landmarks[42], landmarks[45])
    left_eye_height = _dist(landmarks[37], landmarks[41])
    right_eye_height = _dist(landmarks[43], landmarks[47])
    eye_distance = _dist(left_eye, right_eye)
    nose_width = _dist(nose_left, nose_right)
    nose_length = _dist(nose_top, nose_tip)
    mouth_width = _dist(mouth_left, mouth_right)

    if face_width <= 0 or face_height <= 0 or nose_width <= 0:
        return FaceValidationResult(
            False,
            "degenerate_geometry",
            {
                "face_width": face_width,
                "face_height": face_height,
                "nose_width": nose_width,
            },
        )

    face_center_x = (jaw_left[0] + jaw_right[0]) / 2
    min_eye_width = min(left_eye_width, right_eye_width)
    max_eye_width = max(left_eye_width, right_eye_width)
    eye_width_balance = min_eye_width / max_eye_width if max_eye_width > 0 else 0.0
    eye_aspect_ratio = (
        ((left_eye_height / left_eye_width) if left_eye_width > 0 else 0.0)
        + ((right_eye_height / right_eye_width) if right_eye_width > 0 else 0.0)
    ) / 2

    metrics = {
        "face_width": face_width,
        "face_height": face_height,
        "yaw": abs((nose_tip[0] - face_center_x) / face_width),
        "eye_width_balance": eye_width_balance,
        "eye_aspect_ratio": eye_aspect_ratio,
        "eye_distance_ratio": eye_distance / face_width,
        "nose_width_ratio": nose_width / face_width,
        "nose_length_ratio": nose_length / face_height,
        "mouth_width_ratio": mouth_width / face_width,
        "mouth_to_nose_ratio": mouth_width / nose_width,
        "eyes_above_nose": 1.0 if max(left_eye[1], right_eye[1]) < nose_tip[1] else 0.0,
        "mouth_below_nose": 1.0 if min(upper_lip[1], lower_lip[1]) > nose_tip[1] else 0.0,
        "mouth_above_chin": 1.0 if lower_lip[1] < chin[1] else 0.0,
        "nose_between_eyes": 1.0 if left_eye[0] < nose_tip[0] < right_eye[0] else 0.0,
    }

    if image_size:
        image_height, image_width = image_size
        if image_width > 0 and image_height > 0:
            xs = [point[0] for point in landmarks]
            ys = [point[1] for point in landmarks]
            bbox_width = max(xs) - min(xs)
            bbox_height = max(ys) - min(ys)
            metrics["face_area_ratio"] = (bbox_width * bbox_height) / (image_width * image_height)

    for key in ("eyes_above_nose", "mouth_below_nose", "mouth_above_chin"):
        if metrics[key] < 0.5:
            return FaceValidationResult(False, f"invalid_{key}", metrics)

    thresholds = (
        ("yaw", 0.0, 0.38),
        ("eye_width_balance", 0.35, 1.01),
        ("eye_aspect_ratio", 0.05, 0.80),
        ("eye_distance_ratio", 0.16, 0.72),
        ("nose_width_ratio", 0.05, 0.45),
        ("nose_length_ratio", 0.07, 0.65),
        ("mouth_width_ratio", 0.15, 0.78),
        ("mouth_to_nose_ratio", 0.75, 4.00),
    )

    soft_failures: list[str] = []
    for key, lo, hi in thresholds:
        if not _metric_between(metrics, key, lo, hi):
            soft_failures.append(key)

    if metrics["nose_between_eyes"] < 0.5:
        soft_failures.append("nose_between_eyes")

    if "face_area_ratio" in metrics and metrics["face_area_ratio"] < 0.02:
        soft_failures.append("face_area_ratio")

    metrics["soft_failure_count"] = float(len(soft_failures))
    if soft_failures:
        metrics["soft_failure_sample"] = float(len(soft_failures[:2]))

    if len(soft_failures) >= 3:
        return FaceValidationResult(False, "multiple_geometry_failures", metrics)

    return FaceValidationResult(True, "ok", metrics)
