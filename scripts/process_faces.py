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

from face_validation import validate_human_face_landmarks
from metric_distribution import apply_distribution_adjusted_scores
from scoring import calculate_face_details

# ---------------------------------------------------------------------------
# Geometry helpers (mirrors web/src/lib/faceScoring.ts)
# ---------------------------------------------------------------------------


Point = Tuple[float, float]


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
    import hashlib
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:8]
    return f"celeb_{h}"


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


def average_embeddings(embeddings: List[List[float]]) -> List[float]:
    """Average multiple 128-dim embeddings and L2-normalize."""
    arr = np.array(embeddings, dtype=np.float64)
    mean = np.mean(arr, axis=0)
    norm = np.linalg.norm(mean)
    if norm > 0:
        mean = mean / norm
    return mean.tolist()


def process_person(
    name: str,
    image_paths: List[Path],
    thumb_dir: Path,
    thumb_size: int,
    model: str,
) -> dict | None:
    """Process all images for one person and return the best result.

    When multiple images yield valid faces, embeddings are averaged
    (L2-normalized) for a more stable representation.
    """
    best_result = None
    best_face_area = 0
    all_embeddings: List[List[float]] = []

    for img_path in image_paths:
        print(f"  Processing {img_path.name} ...", end=" ")
        # Use numpy to handle non-ASCII file paths (cv2.imread fails on Windows)
        buf = np.fromfile(str(img_path), dtype=np.uint8)
        bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if bgr is None:
            print("SKIP (cannot read)")
            continue

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        locations = face_recognition.face_locations(rgb, model=model)
        if not locations:
            print("SKIP (no face detected)")
            continue

        image_has_valid_face = False
        for loc in locations:
            raw_landmarks = face_recognition.face_landmarks(rgb, [loc])
            if not raw_landmarks:
                continue

            regions = raw_landmarks[0]
            ordered: List[Point] = []
            ordered.extend(regions.get("chin", []))          # 0-16  (17 points)
            ordered.extend(regions.get("left_eyebrow", []))  # 17-21 (5 points)
            ordered.extend(regions.get("right_eyebrow", [])) # 22-26 (5 points)
            ordered.extend(regions.get("nose_bridge", []))   # 27-30 (4 points)
            ordered.extend(regions.get("nose_tip", []))      # 31-35 (5 points)
            ordered.extend(regions.get("left_eye", []))      # 36-41 (6 points)
            ordered.extend(regions.get("right_eye", []))     # 42-47 (6 points)
            ordered.extend(regions.get("top_lip", []))       # 48-59 (12 points)
            ordered.extend(regions.get("bottom_lip", []))    # 60-67 (12 points)

            if len(ordered) < 68:
                continue

            landmarks: List[Point] = [(float(p[0]), float(p[1])) for p in ordered[:68]]
            validation = validate_human_face_landmarks(landmarks, image_size=rgb.shape[:2])
            if not validation.valid:
                continue

            encodings = face_recognition.face_encodings(rgb, [loc])
            if not encodings:
                continue

            image_has_valid_face = True
            embedding = encodings[0].tolist()
            all_embeddings.append(embedding)
            t, r, b, l = loc
            area = (b - t) * (r - l)
            if area > best_face_area:
                best_face_area = area
                best_result = {
                    "bgr": bgr,
                    "loc": loc,
                    "landmarks": landmarks,
                }

        if not image_has_valid_face:
            print("SKIP (no human-like face geometry)")
            continue

        print(f"OK ({len(all_embeddings)} embedding(s) total)")

    if best_result is None or not all_embeddings:
        return None

    # Average embeddings from all valid photos for stability
    if len(all_embeddings) > 1:
        print(f"  Averaging {len(all_embeddings)} embeddings")
        final_embedding = average_embeddings(all_embeddings)
    else:
        final_embedding = all_embeddings[0]

    person_id = name_to_id(name)
    details = calculate_face_details(best_result["landmarks"])
    score = 0.0  # overwritten by apply_distribution_adjusted_scores() in main()

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
        "embedding": final_embedding,
        "thumbnail": f"data/thumbnails/{person_id}.jpg",
        "faceValidationStatus": "accepted",
        "faceValidationReason": "ok",
        "faceValidationSource": "face_recognition",
        "embeddingCount": len(all_embeddings),
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

    apply_distribution_adjusted_scores(celebrities)

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
