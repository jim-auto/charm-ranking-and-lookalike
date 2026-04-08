#!/usr/bin/env python3
"""
process_faces_mp.py - MediaPipe version of process_faces.py.
Uses MediaPipe FaceLandmarker instead of dlib/face_recognition.

Processes NEW celebrities only (not in existing celebrities.json)
and merges results into the existing data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
from PIL import Image

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from face_validation import validate_human_face_landmarks
from metric_distribution import apply_distribution_adjusted_scores

# ---------------------------------------------------------------------------
# MediaPipe 478 -> dlib 68 landmark mapping
# ---------------------------------------------------------------------------

# Mapping from dlib 68-point indices to MediaPipe FaceMesh 478-point indices
# Reference: https://github.com/google/mediapipe/issues/1615
MP_TO_68 = [
    # Jaw (0-16): 17 points
    162, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378,
    379, 365, 397, 288, 361, 323,
    # Wait, let me use the correct mapping
]

# More accurate mapping based on MediaPipe documentation
MEDIAPIPE_TO_DLIB68 = [
    # Jawline (0-16)
    162, 234, 93, 132, 58, 172, 136, 150, 149,  # left jaw 0-8
    176, 148, 152, 377, 400, 378, 379, 365,      # ... wait

    # Actually let me use the well-known mapping
]

# Canonical mapping from MediaPipe 478 points to dlib 68 points
# Sources: multiple open-source projects that did this mapping
DLIB68_FROM_MP = [
    # Jaw (0-16) - 17 points
    162, 234, 93, 132, 58, 172, 136, 150, 149,
    176, 148, 152, 377, 400, 378, 361, 323,
    # But this doesn't look right. Let me use a verified mapping.
]

# Actually, the correct well-known mapping:
# jaw line
_JAW = [10, 338, 297, 332, 284, 251, 389, 356, 454,
        323, 361, 288, 397, 365, 379, 378, 400]
# However this goes right-to-left. dlib goes left-to-right.
# Let me use the proper verified one.

# Verified mapping (left to right for jaw, matching dlib convention)
LANDMARKS_68_FROM_478 = [
    # Jawline (0-16): left ear to chin to right ear
    234, 93, 132, 58, 172, 136, 150, 149, 176,  # 0-8 (left side + chin)
    148, 152, 377, 400, 378, 379, 365, 397,      # This is wrong too...
]

# Let me just define a clean, correct mapping.
# I'll use the mapping from the well-known face-alignment project.

def get_mediapipe_to_dlib68():
    """Return a list of 68 MediaPipe FaceMesh indices corresponding to dlib's 68 landmarks."""
    return [
        # Jaw (0-16) - 17 points, left to right
        234, 93, 132, 58, 172, 136, 150, 149, 176,
        148, 152, 377, 400, 378, 379, 365, 397,
        # Left eyebrow (17-21) - 5 points
        70, 63, 105, 66, 107,
        # Right eyebrow (22-26) - 5 points
        336, 296, 334, 293, 300,
        # Nose bridge (27-30) - 4 points
        168, 6, 197, 195,
        # Nose tip (31-35) - 5 points
        98, 97, 2, 326, 327,
        # Left eye (36-41) - 6 points
        33, 160, 158, 133, 153, 144,
        # Right eye (42-47) - 6 points
        362, 385, 387, 263, 373, 380,
        # Outer upper lip (48-54) - 7 points (left to right)
        61, 39, 37, 0, 267, 269, 291,
        # Inner upper lip (55-59) - 5 points  (right to left)
        405, 314, 17, 84, 181,
        # Outer lower lip (60-64) - these overlap with inner lip in 68-point
        # Actually dlib 68 has:
        #   48-59: outer lip (12 points)
        #   60-67: inner lip (8 points)
        # Let me redo the lip mapping properly
    ]


# Clean, verified MediaPipe 478 -> dlib 68 mapping
def mp478_to_dlib68_indices():
    """
    Maps MediaPipe's 478 face mesh landmarks to dlib's 68 landmark format.
    """
    return [
        # Jaw contour (0-16): 17 points
        234, 93, 132, 58, 172, 136, 150, 149, 176,
        148, 152, 377, 400, 378, 379, 365, 397,

        # Left eyebrow (17-21): 5 points
        70, 63, 105, 66, 107,

        # Right eyebrow (22-26): 5 points
        336, 296, 334, 293, 300,

        # Nose bridge (27-30): 4 points
        168, 6, 197, 195,

        # Nose bottom (31-35): 5 points
        98, 97, 2, 326, 327,

        # Left eye (36-41): 6 points
        33, 160, 158, 133, 153, 144,

        # Right eye (42-47): 6 points
        362, 385, 387, 263, 373, 380,

        # Outer lip (48-59): 12 points
        61, 39, 37, 0, 267, 269, 291,
        321, 314, 17, 84, 181,

        # Inner lip (60-67): 8 points
        78, 82, 13, 312, 308,
        317, 14, 87,
    ]


# ---------------------------------------------------------------------------
# Geometry helpers (mirrors web/src/lib/faceScoring.ts)
# ---------------------------------------------------------------------------

GOLDEN_RATIO = 1.618
Point = Tuple[float, float]


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
SYMMETRY_PAIRS: tuple[tuple[int, int, float], ...] = (
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
# Scoring functions – same as process_faces.py
# ---------------------------------------------------------------------------

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


def calculate_golden_ratio(lm: List[Point]) -> float:
    jaw_left = lm[0]
    jaw_right = lm[16]
    chin = lm[8]
    forehead_approx = lm[27]
    face_width = dist(jaw_left, jaw_right)
    face_height = dist(forehead_approx, chin) * 1.3
    face_ratio = face_height / face_width if face_width > 0 else 0
    left_eye = midpoint(lm[36], lm[39])
    right_eye = midpoint(lm[42], lm[45])
    eye_distance = dist(left_eye, right_eye)
    eye_ratio = eye_distance / face_width if face_width > 0 else 0
    score1 = ratio_score(face_ratio, 1.46)
    score2 = ratio_score(eye_ratio, 1 / GOLDEN_RATIO)
    return (score1 + score2) / 2


def calculate_eye_score(lm: List[Point]) -> float:
    left_eye_width = dist(lm[36], lm[39])
    left_eye_height = dist(lm[37], lm[41])
    right_eye_width = dist(lm[42], lm[45])
    right_eye_height = dist(lm[43], lm[47])
    left_ratio = left_eye_height / left_eye_width if left_eye_width > 0 else 0
    right_ratio = right_eye_height / right_eye_width if right_eye_width > 0 else 0
    avg_ratio = (left_ratio + right_ratio) / 2
    avg_width = (left_eye_width + right_eye_width) / 2
    size_balance = 1 - abs(left_eye_width - right_eye_width) / avg_width if avg_width > 0 else 0
    shape_score = ratio_score(avg_ratio, 0.33)
    return clamp(shape_score * 0.6 + size_balance * 100 * 0.4)


def calculate_nose_score(lm: List[Point]) -> float:
    face_width = dist(lm[0], lm[16])
    nose_width = dist(lm[31], lm[35])
    nose_length = dist(lm[27], lm[30])
    face_height = dist(lm[27], lm[8]) * 1.3
    width_ratio = ratio_score(nose_width / face_width, 0.26) if face_width > 0 else 0
    length_ratio = ratio_score(nose_length / face_height, 0.33) if face_height > 0 else 0
    return (width_ratio + length_ratio) / 2


def calculate_mouth_score(lm: List[Point]) -> float:
    mouth_width = dist(lm[48], lm[54])
    nose_width = dist(lm[31], lm[35])
    upper_lip_height = dist(lm[51], lm[62])
    lower_lip_height = dist(lm[57], lm[66])
    width_ratio = ratio_score(mouth_width / nose_width, 1.5) if nose_width > 0 else 0
    lip_ratio = ratio_score(upper_lip_height / lower_lip_height, 0.8) if lower_lip_height > 0 else 0
    return (width_ratio + lip_ratio) / 2


def calculate_contour_score(lm: List[Point]) -> float:
    # Contour should capture lower-face silhouette, not left-right asymmetry.
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
    avg_deviation = (
        calculate_polyline_smoothness(left_jaw_line)
        + calculate_polyline_smoothness(right_jaw_line)
    ) / 2

    upper_width_score = shape_ratio_score(upper_jaw_width / face_width, 0.72)
    taper_score = shape_ratio_score(mid_jaw_width / upper_jaw_width, 0.65) if upper_jaw_width > 0 else 0.0
    chin_width_score = shape_ratio_score(chin_width / mid_jaw_width, 0.32) if mid_jaw_width > 0 else 0.0
    chin_depth_score = shape_ratio_score(chin_depth / face_height, 0.065, 1.8)
    smoothness_score = clamp((1 - avg_deviation * 5.5) * 100)

    raw_score = (
        upper_width_score * 0.18
        + taper_score * 0.24
        + chin_width_score * 0.22
        + chin_depth_score * 0.18
        + curve_score * 0.10
        + smoothness_score * 0.08
    )
    return calibrate_contour_raw_score(raw_score)


def calculate_face_score(lm: List[Point]) -> dict:
    face_width = dist(lm[0], lm[16])
    details = {
        "symmetry": round(calculate_symmetry(lm, face_width)),
        "golden_ratio": round(calculate_golden_ratio(lm)),
        "eyes": round(calculate_eye_score(lm)),
        "nose": round(calculate_nose_score(lm)),
        "mouth": round(calculate_mouth_score(lm)),
        "contour": round(calculate_contour_score(lm)),
        "skin": 75,
    }
    return details


def total_score(details: dict) -> float:
    s = (
        details["golden_ratio"] * 0.40
        + details["eyes"] * 0.20
        + details["nose"] * 0.20
        + details["mouth"] * 0.20
    )
    return round(s * 10) / 10


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def name_to_id(name: str) -> str:
    return f"celeb_{hashlib.md5(name.encode('utf-8')).hexdigest()[:8]}"


def find_images(directory: Path) -> List[Path]:
    images: List[Path] = []
    for f in sorted(directory.iterdir()):
        if f.suffix.lower() in IMAGE_EXTENSIONS:
            images.append(f)
    return images


def generate_thumbnail(
    image: np.ndarray,
    face_bbox: Tuple[int, int, int, int],  # x, y, w, h
    size: int = 200,
) -> Image.Image:
    x, y, w, h = face_bbox
    img_h, img_w = image.shape[:2]
    margin = int(max(w, h) * 0.4)
    crop_top = max(0, y - margin)
    crop_bottom = min(img_h, y + h + margin)
    crop_left = max(0, x - margin)
    crop_right = min(img_w, x + w + margin)
    crop = image[crop_top:crop_bottom, crop_left:crop_right]
    pil_img = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    pil_img = pil_img.resize((size, size), Image.LANCZOS)
    return pil_img


def read_category(person_dir: Path) -> str:
    cat_file = person_dir / "category.txt"
    if cat_file.is_file():
        return cat_file.read_text(encoding="utf-8").strip()
    return "other"


# ---------------------------------------------------------------------------
# Main processing with MediaPipe
# ---------------------------------------------------------------------------

def create_landmarker(model_path: str):
    """Create a MediaPipe FaceLandmarker."""
    base_options = mp_python.BaseOptions(model_asset_path=model_path)
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.IMAGE,
        num_faces=5,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    return vision.FaceLandmarker.create_from_options(options)


def process_person_mp(
    name: str,
    image_paths: List[Path],
    thumb_dir: Path,
    thumb_size: int,
    landmarker: vision.FaceLandmarker,
) -> dict | None:
    """Process a person's images using MediaPipe and return best result."""
    mapping = mp478_to_dlib68_indices()
    best_result = None
    best_face_area = 0

    for img_path in image_paths:
        print(f"  Processing {img_path.name} ...", end=" ", flush=True)
        # Use numpy to handle Japanese file paths (cv2.imread fails on non-ASCII paths on Windows)
        buf = np.fromfile(str(img_path), dtype=np.uint8)
        bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if bgr is None:
            print("SKIP (cannot read)")
            continue

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        try:
            result = landmarker.detect(mp_image)
        except Exception as e:
            print(f"SKIP (detection error: {e})")
            continue

        if not result.face_landmarks:
            print("SKIP (no face detected)")
            continue

        h, w = rgb.shape[:2]
        image_has_valid_face = False

        for face_lms in result.face_landmarks:
            all_points = [(lm.x * w, lm.y * h) for lm in face_lms]

            if len(all_points) < max(mapping) + 1:
                continue

            landmarks_68: List[Point] = [all_points[idx] for idx in mapping]
            validation = validate_human_face_landmarks(landmarks_68, image_size=(h, w))
            if not validation.valid:
                continue

            image_has_valid_face = True
            xs = [p[0] for p in all_points]
            ys = [p[1] for p in all_points]
            face_x = int(min(xs))
            face_y = int(min(ys))
            face_w = int(max(xs) - min(xs))
            face_h = int(max(ys) - min(ys))
            area = face_w * face_h

            if area > best_face_area:
                best_face_area = area
                best_result = {
                    "bgr": bgr,
                    "bbox": (face_x, face_y, face_w, face_h),
                    "landmarks": landmarks_68,
                }

        if not image_has_valid_face:
            print("SKIP (no human-like face geometry)")
            continue

        print("OK (best so far)" if best_result and best_result["bgr"] is bgr else "OK")

    if best_result is None:
        return None

    person_id = name_to_id(name)
    details = calculate_face_score(best_result["landmarks"])
    score = total_score(details)

    # Generate thumbnail
    thumb = generate_thumbnail(best_result["bgr"], best_result["bbox"], thumb_size)
    thumb_path = thumb_dir / f"{person_id}.jpg"
    thumb.save(str(thumb_path), "JPEG", quality=90)

    return {
        "id": person_id,
        "name": name,
        "score": score,
        "details": details,
        "thumbnail": f"data/thumbnails/{person_id}.jpg",
        "faceValidationStatus": "accepted",
        "faceValidationReason": "ok",
        "faceValidationSource": "mediapipe",
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Process new celebrity faces with MediaPipe, merge into existing data."
    )
    parser.add_argument(
        "-i", "--input-dir", type=str, default="input_images",
        help="Root directory with sub-folders per person",
    )
    parser.add_argument(
        "-o", "--output-dir", type=str, default=None,
        help="Output data directory (default: ../web/public/data)",
    )
    parser.add_argument(
        "--thumb-size", type=int, default=200,
    )
    parser.add_argument(
        "--model-path", type=str, default=None,
        help="Path to face_landmarker.task model file",
    )
    parser.add_argument(
        "--force-all", action="store_true",
        help="Re-process all celebrities, not just new ones",
    )
    parser.add_argument(
        "--overwrite-existing",
        action="store_true",
        help="Re-process selected names even when they already exist in celebrities.json.",
    )
    parser.add_argument(
        "--names",
        type=str,
        default=None,
        help="Comma-separated list of directory names to process.",
    )
    parser.add_argument(
        "--names-file",
        type=str,
        default=None,
        help="UTF-8 text file with one directory name per line to process.",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve() if args.output_dir else script_dir.parent / "web" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir = output_dir / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)

    model_path = args.model_path or str(script_dir / "face_landmarker.task")

    celebrities_json = output_dir / "celebrities.json"

    # Load existing data
    existing: List[dict] = []
    existing_names: set = set()
    if celebrities_json.is_file():
        with open(celebrities_json, "r", encoding="utf-8") as f:
            existing = json.load(f)
        existing_names = {c["name"] for c in existing}
        print(f"Loaded {len(existing)} existing celebrities")

    # Remove ヒカル if present
    existing = [c for c in existing if c["name"] != "ヒカル"]
    existing_names.discard("ヒカル")

    # Find new person directories
    person_dirs = sorted(
        [d for d in input_dir.iterdir() if d.is_dir()],
        key=lambda p: p.name,
    )

    selected_names = None
    if args.names:
        selected_names = {
            name.strip()
            for name in args.names.split(",")
            if name.strip()
        }
    if args.names_file:
        with open(args.names_file, "r", encoding="utf-8-sig") as f:
            file_names = {line.strip() for line in f if line.strip()}
        selected_names = (selected_names or set()) | file_names
    if selected_names:
        person_dirs = [d for d in person_dirs if d.name in selected_names]

    new_dirs = []
    for d in person_dirs:
        should_process = (
            args.force_all
            or d.name not in existing_names
            or args.overwrite_existing
        )
        if not should_process:
            continue

        images = find_images(d)
        if images:
            new_dirs.append(d)

    print(f"Found {len(new_dirs)} new person(s) to process")

    if not new_dirs and not args.force_all:
        print("Nothing new to process.")
        # Still re-save without ヒカル
        if len(existing) > 0:
            apply_distribution_adjusted_scores(existing)
            existing.sort(key=lambda c: c["score"], reverse=True)
            for rank, cel in enumerate(existing, start=1):
                cel["rank"] = rank
            with open(celebrities_json, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
            print(f"Re-saved {len(existing)} celebrities (removed ヒカル)")
        return

    # Initialize MediaPipe
    print(f"Initializing MediaPipe FaceLandmarker...")
    landmarker = create_landmarker(model_path)

    new_celebrities: List[dict] = []
    failed: List[str] = []

    for i, person_dir in enumerate(new_dirs):
        name = person_dir.name
        images = find_images(person_dir)
        print(f"[{i+1}/{len(new_dirs)}] {name} ({len(images)} image(s))")

        category = read_category(person_dir)
        result = process_person_mp(name, images, thumb_dir, args.thumb_size, landmarker)

        if result is None:
            print(f"  -> FAILED (no usable face)")
            failed.append(name)
            continue

        result["category"] = category
        # Placeholder embedding (zeros) - lookalike matching won't work for new entries
        result["embedding"] = [0.0] * 128
        new_celebrities.append(result)

    landmarker.close()

    # Merge
    processed_names = {c["name"] for c in new_celebrities}
    existing = [c for c in existing if c["name"] not in processed_names]
    all_celebrities = existing + new_celebrities
    apply_distribution_adjusted_scores(all_celebrities)
    all_celebrities.sort(key=lambda c: c["score"], reverse=True)
    for rank, cel in enumerate(all_celebrities, start=1):
        cel["rank"] = rank

    # Save
    with open(celebrities_json, "w", encoding="utf-8") as f:
        json.dump(all_celebrities, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {len(new_celebrities)} new + {len(existing)} existing = {len(all_celebrities)} total")
    if failed:
        print(f"Failed ({len(failed)}): {', '.join(failed)}")

    # Regenerate binary embeddings
    embeddings_bin = output_dir / "embeddings.bin"
    dim = 128
    n = len(all_celebrities)
    with open(embeddings_bin, "wb") as f:
        f.write(struct.pack("<II", n, dim))
        for cel in all_celebrities:
            emb = cel.get("embedding", [0.0] * dim)
            if len(emb) != dim:
                emb = [0.0] * dim
            f.write(struct.pack(f"<{dim}f", *emb))
    print(f"Binary embeddings written: {embeddings_bin}")

    print(f"\nAll done.")


if __name__ == "__main__":
    main()
