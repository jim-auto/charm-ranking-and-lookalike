#!/usr/bin/env python3
"""
reprocess_all.py - Re-process ALL celebrities with MediaPipe.
Preserves existing metadata (age, gender, sns, group) while recalculating scores.
"""

from __future__ import annotations

import hashlib
import json
import math
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

from ranking_policy import build_ranking_policy, deviation

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_DIR = SCRIPT_DIR / "input_images"
OUTPUT_DIR = SCRIPT_DIR.parent / "web" / "public" / "data"
MODEL_PATH = SCRIPT_DIR / "face_landmarker.task"

Point = Tuple[float, float]
GOLDEN_RATIO = 1.618


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

def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))

def ratio_score(actual: float, ideal: float) -> float:
    deviation = abs(actual - ideal) / ideal
    return clamp((1 - deviation * 2) * 100)


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
    jaw = lm[0:17]
    sm = 0.0
    for i in range(1, len(jaw) - 1):
        exp = midpoint(jaw[i-1], jaw[i+1])
        dev = dist(jaw[i], exp)
        seg = dist(jaw[i-1], jaw[i+1])
        sm += (dev / seg) if seg > 0 else 0
    avg = sm / (len(jaw) - 2)
    return clamp((1 - avg * 8) * 100)

def compute_score(lm):
    """Compute face score using same weights as frontend."""
    gr = round(calculate_golden_ratio(lm))
    ey = round(calculate_eye_score(lm))
    no = round(calculate_nose_score(lm))
    mo = round(calculate_mouth_score(lm))
    co = round(calculate_contour_score(lm))
    details = {
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

def read_category(person_dir: Path) -> str:
    cat_file = person_dir / "category.txt"
    if cat_file.is_file():
        return cat_file.read_text(encoding="utf-8").strip()
    return "other"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
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
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    mapping = mp478_to_dlib68_indices()

    # Process all
    person_dirs = sorted(
        [d for d in INPUT_DIR.iterdir() if d.is_dir()],
        key=lambda p: p.name,
    )

    results = []
    failed = []

    for i, person_dir in enumerate(person_dirs):
        name = person_dir.name

        # Skip ヒカル
        if name == "ヒカル":
            continue

        # Find image
        img_files = [f for f in person_dir.iterdir()
                     if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}]
        if not img_files:
            continue

        img_path = img_files[0]
        buf = np.fromfile(str(img_path), dtype=np.uint8)
        bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if bgr is None:
            failed.append(name)
            continue

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        try:
            result = landmarker.detect(mp_image)
        except Exception:
            failed.append(name)
            continue

        if not result.face_landmarks:
            failed.append(name)
            continue

        face_lms = result.face_landmarks[0]
        h, w = rgb.shape[:2]
        all_pts = [(lm.x * w, lm.y * h) for lm in face_lms]

        if len(all_pts) < max(mapping) + 1:
            failed.append(name)
            continue

        lm68 = [all_pts[idx] for idx in mapping]
        score, details = compute_score(lm68)

        # Generate thumbnail
        xs = [p[0] for p in all_pts]
        ys = [p[1] for p in all_pts]
        fx, fy = int(min(xs)), int(min(ys))
        fw, fh = int(max(xs) - min(xs)), int(max(ys) - min(ys))
        margin = int(max(fw, fh) * 0.4)
        ct, cb = max(0, fy - margin), min(h, fy + fh + margin)
        cl, cr = max(0, fx - margin), min(w, fx + fw + margin)
        crop = bgr[ct:cb, cl:cr]
        pil_img = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        pil_img = pil_img.resize((200, 200), Image.LANCZOS)

        celeb_id = name_to_id(name)
        thumb_path = thumb_dir / f"{celeb_id}.jpg"
        pil_img.save(str(thumb_path), "JPEG", quality=90)

        # Build entry, preserving metadata from existing data
        old = existing_meta.get(name, {})
        category = old.get("category") or read_category(person_dir)
        gender = old.get("gender", "male" if category in ("actor", "comedian", "athlete", "politician", "youtuber") else "female")

        entry = {
            "id": celeb_id,
            "name": name,
            "category": category,
            "gender": gender,
            "score": score,
            "details": details,
            "thumbnail": f"data/thumbnails/{celeb_id}.jpg",
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

        # Compute score variants
        entry["scores"] = {"face": score}
        if "age" in entry:
            age = entry["age"]
            age_bonus = max(0, 5 - abs(age - 23)) if abs(age - 23) <= 5 else 0
            entry["scores"]["faceAge"] = round((score + age_bonus) * 10) / 10
        else:
            entry["scores"]["faceAge"] = score

        if "totalFollowers" in entry and entry["totalFollowers"] > 0:
            import math as m
            sns_score = min(100, m.log10(max(1, entry["totalFollowers"])) * 10)
            entry["scores"]["faceSns"] = round((score * 0.7 + sns_score * 0.3) * 10) / 10
        else:
            entry["scores"]["faceSns"] = score

        entry["scores"]["faceAgeSns"] = entry["scores"].get("faceSns", score)

        results.append(entry)
        if (i + 1) % 20 == 0:
            print(f"  Processed {i+1} dirs, {len(results)} OK so far...", flush=True)

    landmarker.close()

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
