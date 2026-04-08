#!/usr/bin/env python3
"""
reprocess_all.py - Re-process ALL celebrities with MediaPipe.
Preserves existing metadata (age, gender, sns, group) while recalculating scores.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from collections import Counter
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
from ranking_policy import build_ranking_policy, deviation, filter_public_entries
from score_policy import age_adjusted_score, round_score

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    import face_recognition
except ImportError:
    face_recognition = None

SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_DIR = SCRIPT_DIR / "input_images"
OUTPUT_DIR = SCRIPT_DIR.parent / "web" / "public" / "data"
MODEL_PATH = SCRIPT_DIR / "face_landmarker.task"

Point = Tuple[float, float]
GOLDEN_RATIO = 1.618
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# ---------------------------------------------------------------------------
# MediaPipe 478 -> dlib 68 mapping
# ---------------------------------------------------------------------------
def mp478_to_dlib68_indices():
    return [
        # Jaw (0-16)
        234, 93, 132, 58, 172, 136, 150, 149, 176,
        148, 152, 377, 400, 378, 379, 365, 397,
        # Left eyebrow (17-21)
        70, 63, 105, 66, 107,
        # Right eyebrow (22-26)
        336, 296, 334, 293, 300,
        # Nose bridge (27-30)
        168, 6, 197, 195,
        # Nose bottom (31-35)
        98, 97, 2, 326, 327,
        # Left eye (36-41)
        33, 160, 158, 133, 153, 144,
        # Right eye (42-47)
        362, 385, 387, 263, 373, 380,
        # Outer lip (48-59)
        61, 39, 37, 0, 267, 269, 291,
        321, 314, 17, 84, 181,
        # Inner lip (60-67)
        78, 82, 13, 312, 308,
        317, 14, 87,
    ]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------
def dist(a: Point, b: Point) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)

def midpoint(a: Point, b: Point) -> Point:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)

def average_point(points: list[Point]) -> Point:
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


def polyline_length(points: list[Point]) -> float:
    if len(points) < 2:
        return 0.0
    return sum(dist(points[i], points[i + 1]) for i in range(len(points) - 1))


SYMMETRY_AXIS_INDICES = (27, 28, 29, 30, 51, 57, 8)
CONTOUR_AXIS_INDICES = (27, 28, 29, 30, 33, 51, 57, 8)
SYMMETRY_PAIRS = (
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


def rotate_landmarks(lm: list[Point]) -> list[Point]:
    left_eye = midpoint(lm[36], lm[39])
    right_eye = midpoint(lm[42], lm[45])
    eye_center = midpoint(left_eye, right_eye)
    roll = -math.atan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0])
    return [rotate_point(point, eye_center, roll) for point in lm]


def calculate_polyline_smoothness(points: list[Point]) -> float:
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
# Scoring (same weights as frontend faceScoring.ts)
# ---------------------------------------------------------------------------
def calculate_golden_ratio(lm):
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

def calculate_symmetry(lm, face_width):
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

def calculate_eye_score(lm):
    lw = dist(lm[36], lm[39]); lh = dist(lm[37], lm[41])
    rw = dist(lm[42], lm[45]); rh = dist(lm[43], lm[47])
    lr = lh / lw if lw > 0 else 0
    rr = rh / rw if rw > 0 else 0
    avg_r = (lr + rr) / 2
    avg_w = (lw + rw) / 2
    bal = 1 - abs(lw - rw) / avg_w if avg_w > 0 else 0
    return clamp(ratio_score(avg_r, 0.33) * 0.6 + bal * 100 * 0.4)

def calculate_nose_score(lm):
    fw = dist(lm[0], lm[16])
    nw = dist(lm[31], lm[35])
    nl = dist(lm[27], lm[30])
    fh = dist(lm[27], lm[8]) * 1.3
    wr = ratio_score(nw / fw, 0.26) if fw > 0 else 0
    lr = ratio_score(nl / fh, 0.33) if fh > 0 else 0
    return (wr + lr) / 2

def calculate_mouth_score(lm):
    mw = dist(lm[48], lm[54])
    nw = dist(lm[31], lm[35])
    ulh = dist(lm[51], lm[62])
    llh = dist(lm[57], lm[66])
    wr = ratio_score(mw / nw, 1.5) if nw > 0 else 0
    lr = ratio_score(ulh / llh, 0.8) if llh > 0 else 0
    return (wr + lr) / 2

def calculate_contour_score(lm):
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

def compute_score(lm):
    """Compute face score using same weights as frontend."""
    fw = dist(lm[0], lm[16])
    gr = round(calculate_golden_ratio(lm))
    ey = round(calculate_eye_score(lm))
    no = round(calculate_nose_score(lm))
    mo = round(calculate_mouth_score(lm))
    co = round(calculate_contour_score(lm))
    sy = round(calculate_symmetry(lm, fw))
    details = {
        "symmetry": sy,
        "golden_ratio": gr,
        "eyes": ey,
        "nose": no,
        "mouth": mo,
        "contour": co,
    }
    # Weights matching frontend (symmetry & skin removed)
    score = gr * 0.35 + ey * 0.15 + no * 0.15 + mo * 0.15 + co * 0.20
    return round(score * 10) / 10, details


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def name_to_id(name: str) -> str:
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:8]
    return f"celeb_{h}"

def find_images(directory: Path) -> list[Path]:
    return [
        file_path
        for file_path in sorted(directory.iterdir())
        if file_path.suffix.lower() in IMAGE_EXTENSIONS
    ]

def regions_to_landmarks_68(regions: dict) -> list[Point] | None:
    ordered: list[Point] = []
    ordered.extend(regions.get("chin", []))
    ordered.extend(regions.get("left_eyebrow", []))
    ordered.extend(regions.get("right_eyebrow", []))
    ordered.extend(regions.get("nose_bridge", []))
    ordered.extend(regions.get("nose_tip", []))
    ordered.extend(regions.get("left_eye", []))
    ordered.extend(regions.get("right_eye", []))
    ordered.extend(regions.get("top_lip", []))
    ordered.extend(regions.get("bottom_lip", []))
    if len(ordered) < 68:
        return None
    return [(float(point[0]), float(point[1])) for point in ordered[:68]]

def detect_face_recognition_candidates(rgb: np.ndarray) -> list[dict]:
    candidates: list[dict] = []
    if face_recognition is None:
        return candidates
    locations = face_recognition.face_locations(rgb, model="hog")
    if not locations:
        return candidates

    for loc in locations:
        raw_landmarks = face_recognition.face_landmarks(rgb, [loc])
        if not raw_landmarks:
            continue

        landmarks = regions_to_landmarks_68(raw_landmarks[0])
        if landmarks is None:
            continue

        validation = validate_human_face_landmarks(landmarks, image_size=rgb.shape[:2])
        if not validation.valid:
            continue

        top, right, bottom, left = loc
        candidates.append(
            {
                "bbox": (left, top, right - left, bottom - top),
                "landmarks": landmarks,
                "area": max(0, right - left) * max(0, bottom - top),
                "source": "face_recognition",
            }
        )

    return candidates

def read_category(person_dir: Path) -> str:
    cat_file = person_dir / "category.txt"
    if cat_file.is_file():
        return cat_file.read_text(encoding="utf-8").strip()
    return "other"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Re-process celebrity faces with feature-layout validation."
    )
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Validate inputs and print a report without overwriting public data.",
    )
    parser.add_argument(
        "--report-json",
        type=str,
        default=None,
        help="Optional JSON path for accepted/rejected audit entries.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only the first N person directories for spot checks.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    thumb_dir = OUTPUT_DIR / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)

    # Load existing metadata
    celebrities_json = OUTPUT_DIR / "celebrities.json"
    existing_meta: dict[str, dict] = {}
    if celebrities_json.is_file():
        with open(celebrities_json, "r", encoding="utf-8") as f:
            for c in json.load(f):
                existing_meta[c["name"]] = c

    # Initialize MediaPipe
    base_options = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.IMAGE,
        num_faces=5,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    mapping = mp478_to_dlib68_indices()

    # Process all
    known_names = set(existing_meta.keys())
    person_dirs = sorted(
        [d for d in INPUT_DIR.iterdir() if d.is_dir() and (not known_names or d.name in known_names)],
        key=lambda p: p.name,
    )
    if args.limit is not None:
        person_dirs = person_dirs[: max(args.limit, 0)]

    results = []
    failed = []
    rejection_reasons: Counter[str] = Counter()
    accepted_sources: Counter[str] = Counter()
    preserved_existing = 0
    audit_entries: list[dict] = []

    for i, person_dir in enumerate(person_dirs):
        name = person_dir.name
        category = existing_meta.get(name, {}).get("category") or read_category(person_dir)

        # Skip ヒカル
        if name == "ヒカル":
            continue

        img_files = find_images(person_dir)
        if not img_files:
            continue

        best_candidate = None
        best_face_area = 0
        last_failure_reason = "no_face_detected"

        for img_path in img_files:
            buf = np.fromfile(str(img_path), dtype=np.uint8)
            bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if bgr is None:
                last_failure_reason = "cannot_read_image"
                rejection_reasons[last_failure_reason] += 1
                continue

            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            try:
                result = landmarker.detect(mp_image)
            except Exception:
                last_failure_reason = "detection_error"
                rejection_reasons[last_failure_reason] += 1
                continue

            if not result.face_landmarks:
                last_failure_reason = "no_face_detected"
                rejection_reasons[last_failure_reason] += 1
            else:
                h, w = rgb.shape[:2]
                for face_landmarks in result.face_landmarks:
                    all_pts = [(lm.x * w, lm.y * h) for lm in face_landmarks]
                    if len(all_pts) < max(mapping) + 1:
                        last_failure_reason = "insufficient_landmarks"
                        rejection_reasons[last_failure_reason] += 1
                        continue

                    lm68 = [all_pts[idx] for idx in mapping]
                    validation = validate_human_face_landmarks(lm68, image_size=(h, w))
                    if not validation.valid:
                        last_failure_reason = validation.reason
                        rejection_reasons[last_failure_reason] += 1
                        continue

                    xs = [p[0] for p in all_pts]
                    ys = [p[1] for p in all_pts]
                    fx, fy = int(min(xs)), int(min(ys))
                    fw, fh = int(max(xs) - min(xs)), int(max(ys) - min(ys))
                    area = fw * fh

                    if area > best_face_area:
                        best_face_area = area
                        best_candidate = {
                            "bgr": bgr,
                            "bbox": (fx, fy, fw, fh),
                            "landmarks": lm68,
                            "source": "mediapipe",
                        }

            if best_candidate is None:
                fallback_candidates = detect_face_recognition_candidates(rgb)
                if not fallback_candidates:
                    if last_failure_reason != "no_face_detected":
                        continue
                for candidate in fallback_candidates:
                    if candidate["area"] > best_face_area:
                        best_face_area = candidate["area"]
                        best_candidate = {
                            "bgr": bgr,
                            "bbox": candidate["bbox"],
                            "landmarks": candidate["landmarks"],
                            "source": candidate["source"],
                        }

        if best_candidate is None:
            old = existing_meta.get(name)
            if old and not args.audit_only:
                preserved = dict(old)
                preserved["category"] = category
                preserved["faceValidationStatus"] = "undetected"
                preserved["faceValidationReason"] = last_failure_reason
                preserved["faceValidationSource"] = "existing_data"
                results.append(preserved)
                preserved_existing += 1
                audit_entries.append(
                    {
                        "name": name,
                        "category": category,
                        "status": "preserved",
                        "reason": last_failure_reason,
                        "source": "existing_data",
                        "imageCount": len(img_files),
                    }
                )
                continue

            failed.append(f"{name} ({last_failure_reason})")
            audit_entries.append(
                {
                    "name": name,
                    "category": category,
                    "status": "rejected",
                    "reason": last_failure_reason,
                    "imageCount": len(img_files),
                }
            )
            continue

        accepted_sources[best_candidate.get("source", "unknown")] += 1

        _, details = compute_score(best_candidate["landmarks"])

        # Generate thumbnail
        fx, fy, fw, fh = best_candidate["bbox"]
        h, w = best_candidate["bgr"].shape[:2]
        margin = int(max(fw, fh) * 0.4)
        ct, cb = max(0, fy - margin), min(h, fy + fh + margin)
        cl, cr = max(0, fx - margin), min(w, fx + fw + margin)
        crop = best_candidate["bgr"][ct:cb, cl:cr]
        celeb_id = name_to_id(name)
        if not args.audit_only:
            pil_img = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            pil_img = pil_img.resize((200, 200), Image.LANCZOS)
            thumb_path = thumb_dir / f"{celeb_id}.jpg"
            pil_img.save(str(thumb_path), "JPEG", quality=90)

        # Build entry, preserving metadata from existing data
        old = existing_meta.get(name, {})
        gender = old.get("gender", "male" if category in ("actor", "comedian", "athlete", "politician", "youtuber") else "female")

        entry = {
            "id": celeb_id,
            "name": name,
            "category": category,
            "gender": gender,
            "score": 0.0,
            "details": details,
            "thumbnail": f"data/thumbnails/{celeb_id}.jpg",
            "faceValidationStatus": "accepted",
            "faceValidationReason": "ok",
            "faceValidationSource": best_candidate.get("source", "unknown"),
        }

        # Preserve rich metadata if available
        if "age" in old:
            entry["age"] = old["age"]
        if "birthDate" in old:
            entry["birthDate"] = old["birthDate"]
        if "sns" in old:
            entry["sns"] = old["sns"]
            entry["totalFollowers"] = old.get("totalFollowers", 0)
        if "group" in old:
            entry["group"] = old["group"]
        if "embedding" in old and old["embedding"] and any(v != 0 for v in old["embedding"]):
            entry["embedding"] = old["embedding"]
        else:
            entry["embedding"] = [0.0] * 128

        results.append(entry)
        audit_entries.append(
            {
                "name": name,
                "category": category,
                "status": "accepted",
                "reason": "ok",
                "source": best_candidate.get("source", "unknown"),
                "imageCount": len(img_files),
            }
        )
        if (i + 1) % 20 == 0:
            print(f"  Processed {i+1} dirs, {len(results)} OK so far...", flush=True)

    landmarker.close()

    if args.report_json:
        report_path = Path(args.report_json).resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "summary": {
                        "processed": len(results) + len(failed),
                        "accepted": len(results),
                        "failed": len(failed),
                        "faceRecognitionFallbackAvailable": face_recognition is not None,
                    },
                    "entries": audit_entries,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        print(f"Audit report: {report_path}")

    if args.audit_only:
        print(f"\nAudit only: accepted={len(results)}, failed={len(failed)}")
        if rejection_reasons:
            print("Audit rejection reasons:")
            for reason, count in rejection_reasons.most_common():
                print(f"  {reason}: {count}")
        if accepted_sources:
            print("Audit accepted sources:")
            for source, count in accepted_sources.most_common():
                print(f"  {source}: {count}")
        return

    for entry in results:
        details = entry.get("details")
        if not isinstance(details, dict):
            continue
        if entry.get("faceValidationStatus") != "accepted" or details.get("symmetry", 0) <= 0:
            details.pop("symmetry", None)

    results = filter_public_entries(results)

    metric_stats = apply_distribution_adjusted_scores(results)
    for entry in results:
        score = entry["score"]
        entry["scores"] = {"face": score}
        entry["scores"]["faceAge"] = age_adjusted_score(score, entry.get("age"))

        if "totalFollowers" in entry and entry["totalFollowers"] > 0:
            sns_score = min(100, math.log10(max(1, entry["totalFollowers"])) * 10)
            entry["scores"]["faceSns"] = round_score(score * 0.7 + sns_score * 0.3)
            entry["scores"]["faceAgeSns"] = round_score(entry["scores"]["faceAge"] * 0.7 + sns_score * 0.3)
        else:
            entry["scores"]["faceSns"] = round_score(score)
            entry["scores"]["faceAgeSns"] = entry["scores"]["faceAge"]

    policy_by_name, stats = build_ranking_policy(results)
    excluded_count = 0
    for entry in results:
        policy = policy_by_name[entry["name"]]
        entry["rankingEligible"] = policy["rankingEligible"]
        if policy["rankingExclusionReasons"]:
            entry["rankingExclusionReasons"] = policy["rankingExclusionReasons"]
            excluded_count += 1
        else:
            entry.pop("rankingExclusionReasons", None)

    # Sort and rank
    results.sort(key=lambda c: c["score"], reverse=True)
    for rank, cel in enumerate(results, start=1):
        cel["rank"] = rank

    # Save
    with open(celebrities_json, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nSaved {len(results)} celebrities to {celebrities_json}")
    print(f"Failed: {len(failed)}")
    print(f"Preserved existing entries: {preserved_existing}")
    if failed:
        print("Rejected / failed examples:")
        for item in failed[:20]:
            print(f"  {item}")
    if rejection_reasons:
        print("Rejection reasons:")
        for reason, count in rejection_reasons.most_common():
            print(f"  {reason}: {count}")
    if accepted_sources:
        print("Accepted sources:")
        for source, count in accepted_sources.most_common():
            print(f"  {source}: {count}")
    print(f"Recommended ranking exclusions: {excluded_count}")

    # Binary embeddings
    embeddings_bin = OUTPUT_DIR / "embeddings.bin"
    dim = 128
    with open(embeddings_bin, "wb") as f:
        f.write(struct.pack("<II", len(results), dim))
        for cel in results:
            emb = cel.get("embedding", [0.0] * dim)
            f.write(struct.pack(f"<{dim}f", *emb))
    print(f"Binary embeddings: {embeddings_bin}")

    # Stats
    scores = [c["score"] for c in results]
    mean = stats["mean"] if scores else 0.0
    stdev = stats["stdev"] if scores else 0.0
    print(f"\nStats: n={len(results)}, mean={mean:.1f}, stdev={stdev:.1f}")
    print("Metric distributions:")
    for metric, stat in metric_stats.items():
        print(
            f"  {metric}: mean={stat['mean']:.1f} median={stat['median']:.1f} "
            f"p10={stat['p10']:.1f} p90={stat['p90']:.1f} stdev={stat['stdev']:.1f}"
        )
    print(f"Top 5:")
    for c in results[:5]:
        dev = 50 + 10 * (c["score"] - mean) / stdev
        print(f"  {c['name']}: score={c['score']:.1f}, dev={dev:.1f}")
    print(f"Bottom 5:")
    for c in results[-5:]:
        dev = 50 + 10 * (c["score"] - mean) / stdev
        print(f"  {c['name']}: score={c['score']:.1f}, dev={dev:.1f}")


if __name__ == "__main__":
    main()
