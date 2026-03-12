#!/usr/bin/env python3
"""
process_faces.py - Detect faces, extract landmarks/embeddings, compute scores,
                   and generate thumbnails + celebrities.json.

Input directory layout:
    input_dir/{name}/image.jpg   (one or more images per person)

Output:
    output_dir/celebrities.json
    output_dir/thumbnails/{id}.jpg
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import List, Tuple

import cv2
import face_recognition
import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Geometry helpers (mirrors web/src/lib/faceScoring.ts)
# ---------------------------------------------------------------------------

GOLDEN_RATIO = 1.618

Point = Tuple[float, float]


def dist(a: Point, b: Point) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def midpoint(a: Point, b: Point) -> Point:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def ratio_score(actual: float, ideal: float) -> float:
    deviation = abs(actual - ideal) / ideal
    return clamp((1 - deviation * 2) * 100)


# ---------------------------------------------------------------------------
# Scoring functions – faithful port of the TypeScript originals
# ---------------------------------------------------------------------------

def calculate_symmetry(lm: List[Point], face_width: float) -> float:
    jaw_left = lm[0:8]
    jaw_right = list(reversed(lm[9:17]))
    nose_bridge = lm[27]

    total_dev = 0.0
    pairs = min(len(jaw_left), len(jaw_right))
    for i in range(pairs):
        left_dist = abs(jaw_left[i][0] - nose_bridge[0])
        right_dist = abs(jaw_right[i][0] - nose_bridge[0])
        total_dev += abs(left_dist - right_dist)
    avg_dev = total_dev / pairs
    return clamp((1 - avg_dev / face_width * 4) * 100)


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

    score1 = ratio_score(face_ratio, GOLDEN_RATIO)
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
    jaw_line = lm[0:17]
    smoothness = 0.0

    for i in range(1, len(jaw_line) - 1):
        expected = midpoint(jaw_line[i - 1], jaw_line[i + 1])
        deviation = dist(jaw_line[i], expected)
        segment_len = dist(jaw_line[i - 1], jaw_line[i + 1])
        smoothness += (deviation / segment_len) if segment_len > 0 else 0

    avg_deviation = smoothness / (len(jaw_line) - 2)
    return clamp((1 - avg_deviation * 8) * 100)


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
        details["symmetry"] * 0.2
        + details["golden_ratio"] * 0.25
        + details["eyes"] * 0.15
        + details["nose"] * 0.1
        + details["mouth"] * 0.1
        + details["contour"] * 0.1
        + details["skin"] * 0.1
    )
    return round(s * 10) / 10


# ---------------------------------------------------------------------------
# Thumbnail generation
# ---------------------------------------------------------------------------

def generate_thumbnail(
    image: np.ndarray,
    face_location: Tuple[int, int, int, int],
    size: int = 200,
) -> Image.Image:
    """Crop face region with some margin and resize to square thumbnail."""
    top, right, bottom, left = face_location
    h, w = image.shape[:2]

    face_h = bottom - top
    face_w = right - left
    margin = int(max(face_h, face_w) * 0.4)

    crop_top = max(0, top - margin)
    crop_bottom = min(h, bottom + margin)
    crop_left = max(0, left - margin)
    crop_right = min(w, right + margin)

    crop = image[crop_top:crop_bottom, crop_left:crop_right]
    pil_img = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    pil_img = pil_img.resize((size, size), Image.LANCZOS)
    return pil_img


# ---------------------------------------------------------------------------
# Name / ID helpers
# ---------------------------------------------------------------------------

def name_to_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def guess_category(name: str) -> str:
    """Placeholder – defaults to 'actor'. Override via a metadata file."""
    return "actor"


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def find_images(directory: Path) -> List[Path]:
    images: List[Path] = []
    for f in sorted(directory.iterdir()):
        if f.suffix.lower() in IMAGE_EXTENSIONS:
            images.append(f)
    return images


def process_person(
    name: str,
    image_paths: List[Path],
    thumb_dir: Path,
    thumb_size: int,
    model: str,
) -> dict | None:
    """Process all images for one person and return the best result."""
    best_result = None
    best_face_area = 0

    for img_path in image_paths:
        print(f"  Processing {img_path.name} ...", end=" ")
        bgr = cv2.imread(str(img_path))
        if bgr is None:
            print("SKIP (cannot read)")
            continue

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        locations = face_recognition.face_locations(rgb, model=model)
        if not locations:
            print("SKIP (no face detected)")
            continue

        # Pick the largest face in the image
        best_idx = 0
        best_area = 0
        for idx, (t, r, b, l) in enumerate(locations):
            area = (b - t) * (r - l)
            if area > best_area:
                best_area = area
                best_idx = idx

        loc = locations[best_idx]

        # 68 landmarks via face_recognition (returns dict of regions)
        raw_landmarks = face_recognition.face_landmarks(rgb, [loc])
        if not raw_landmarks:
            print("SKIP (no landmarks)")
            continue

        # Reconstruct the ordered 68-point list from the region dict
        regions = raw_landmarks[0]
        ordered: List[Point] = []
        ordered.extend(regions.get("chin", []))          # 0-16  (17 points)
        ordered.extend(regions.get("left_eyebrow", []))  # 17-21 (5 points)
        ordered.extend(regions.get("right_eyebrow", [])) # 22-26 (5 points)
        ordered.extend(regions.get("nose_bridge", []))    # 27-30 (4 points)
        ordered.extend(regions.get("nose_tip", []))       # 31-35 (5 points)
        ordered.extend(regions.get("left_eye", []))       # 36-41 (6 points)
        ordered.extend(regions.get("right_eye", []))      # 42-47 (6 points)
        ordered.extend(regions.get("top_lip", []))        # 48-59 (12 points)
        ordered.extend(regions.get("bottom_lip", []))     # 60-67 (12 points)

        if len(ordered) < 68:
            print(f"SKIP (only {len(ordered)} landmarks)")
            continue

        landmarks: List[Point] = [(float(p[0]), float(p[1])) for p in ordered[:68]]

        # 128-dim embedding
        encodings = face_recognition.face_encodings(rgb, [loc])
        if not encodings:
            print("SKIP (no encoding)")
            continue

        embedding = encodings[0].tolist()

        t, r, b, l = loc
        area = (b - t) * (r - l)
        if area > best_face_area:
            best_face_area = area
            best_result = {
                "bgr": bgr,
                "loc": loc,
                "landmarks": landmarks,
                "embedding": embedding,
            }
            print("OK (best so far)")
        else:
            print("OK (smaller face, skipped)")

    if best_result is None:
        return None

    person_id = name_to_id(name)
    details = calculate_face_score(best_result["landmarks"])
    score = total_score(details)

    # Generate thumbnail
    thumb = generate_thumbnail(best_result["bgr"], best_result["loc"], thumb_size)
    thumb_path = thumb_dir / f"{person_id}.jpg"
    thumb.save(str(thumb_path), "JPEG", quality=90)

    return {
        "id": person_id,
        "name": name,
        "category": guess_category(name),
        "score": score,
        "details": details,
        "embedding": best_result["embedding"],
        "thumbnail": f"data/thumbnails/{person_id}.jpg",
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Process celebrity face images: detect, score, and export."
    )
    parser.add_argument(
        "-i", "--input-dir",
        type=str,
        default="input_images",
        help="Root directory with sub-folders per person (default: input_images)",
    )
    parser.add_argument(
        "-o", "--output-dir",
        type=str,
        default="output",
        help="Directory for celebrities.json and thumbnails/ (default: output)",
    )
    parser.add_argument(
        "--thumb-size",
        type=int,
        default=200,
        help="Thumbnail width/height in pixels (default: 200)",
    )
    parser.add_argument(
        "--model",
        choices=["hog", "cnn"],
        default="hog",
        help="Face detection model: hog (fast) or cnn (accurate, needs GPU) (default: hog)",
    )
    parser.add_argument(
        "--category-file",
        type=str,
        default=None,
        help="Optional JSON file mapping name -> category (actor|actress|idol|influencer)",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    thumb_dir = output_dir / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.is_dir():
        print(f"Error: input directory does not exist: {input_dir}", file=sys.stderr)
        sys.exit(1)

    # Optional category mapping
    category_map: dict[str, str] = {}
    if args.category_file:
        cat_path = Path(args.category_file)
        if cat_path.is_file():
            with open(cat_path, "r", encoding="utf-8") as f:
                category_map = json.load(f)

    # Discover person sub-directories
    person_dirs = sorted(
        [d for d in input_dir.iterdir() if d.is_dir()],
        key=lambda p: p.name,
    )

    if not person_dirs:
        print(f"No sub-directories found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(person_dirs)} person(s) in {input_dir}")

    celebrities: List[dict] = []

    for person_dir in person_dirs:
        name = person_dir.name
        images = find_images(person_dir)
        if not images:
            print(f"[{name}] No images found, skipping.")
            continue

        print(f"[{name}] {len(images)} image(s)")
        result = process_person(name, images, thumb_dir, args.thumb_size, args.model)

        if result is None:
            print(f"[{name}] Could not detect a usable face in any image.")
            continue

        # Apply category override if available
        if name in category_map:
            result["category"] = category_map[name]

        celebrities.append(result)

    # Sort by score descending
    celebrities.sort(key=lambda c: c["score"], reverse=True)

    # Assign rank
    for rank, cel in enumerate(celebrities, start=1):
        cel["rank"] = rank

    out_path = output_dir / "celebrities.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(celebrities, f, ensure_ascii=False, indent=2)

    print(f"\nDone. {len(celebrities)} celebrities written to {out_path}")
    print(f"Thumbnails saved in {thumb_dir}")


if __name__ == "__main__":
    main()
