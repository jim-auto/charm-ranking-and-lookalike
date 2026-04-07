#!/usr/bin/env python3
"""Merge existing metadata (category, age, gender, sns, group) into new celebrities.json.
Also reads category.txt from input_images for new entries."""

import json
import math
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_DIR = SCRIPT_DIR / "input_images"
DATA_DIR = SCRIPT_DIR.parent / "web" / "public" / "data"
META_FILE = SCRIPT_DIR / "meta_backup.json"

# Load current data
with open(DATA_DIR / "celebrities.json", "r", encoding="utf-8") as f:
    celebrities = json.load(f)

# Load metadata backup
with open(META_FILE, "r", encoding="utf-8") as f:
    meta = json.load(f)

updated = 0
for cel in celebrities:
    name = cel["name"]

    # Apply saved metadata
    if name in meta:
        m = meta[name]
        for key in ("category", "age", "gender", "sns", "totalFollowers", "group"):
            if key in m and key not in cel or cel.get(key) == "actor":
                cel[key] = m[key]
        updated += 1
    else:
        # Read category.txt for new entries
        cat_file = INPUT_DIR / name / "category.txt"
        if cat_file.is_file():
            cel["category"] = cat_file.read_text(encoding="utf-8").strip()

    # Ensure gender exists
    if "gender" not in cel:
        cat = cel.get("category", "")
        if cat in ("actress", "idol"):
            cel["gender"] = "female"
        elif cat in ("actor",):
            cel["gender"] = "male"
        else:
            cel["gender"] = "unknown"

    # Recalculate score variants
    score = cel["score"]
    cel["scores"] = {"face": score}

    # Age adjustment
    if "age" in cel:
        age = cel["age"]
        age_bonus = max(0, 5 - abs(age - 23)) if abs(age - 23) <= 5 else 0
        cel["scores"]["faceAge"] = round((score + age_bonus) * 10) / 10
    else:
        cel["scores"]["faceAge"] = score

    # SNS adjustment
    if "totalFollowers" in cel and cel["totalFollowers"] > 0:
        sns_score = min(100, math.log10(max(1, cel["totalFollowers"])) * 10)
        cel["scores"]["faceSns"] = round((score * 0.7 + sns_score * 0.3) * 10) / 10
        cel["scores"]["faceAgeSns"] = round((cel["scores"]["faceAge"] * 0.7 + sns_score * 0.3) * 10) / 10
    else:
        cel["scores"]["faceSns"] = score
        cel["scores"]["faceAgeSns"] = cel["scores"]["faceAge"]

# Re-rank
celebrities.sort(key=lambda c: c["score"], reverse=True)
for rank, cel in enumerate(celebrities, start=1):
    cel["rank"] = rank

# Save
with open(DATA_DIR / "celebrities.json", "w", encoding="utf-8") as f:
    json.dump(celebrities, f, ensure_ascii=False, indent=2)

print(f"Updated {updated} entries with existing metadata")
print(f"Total: {len(celebrities)} celebrities")

# Print distribution
import statistics
scores = [c["score"] for c in celebrities]
mean = statistics.mean(scores)
stdev = statistics.stdev(scores)
print(f"\nMean: {mean:.1f}, StdDev: {stdev:.1f}")

print("\n=== Top 15 ===")
for i, c in enumerate(celebrities[:15]):
    dev = 50 + 10 * (c["score"] - mean) / stdev
    print(f'{i+1:3d}. {c["name"]:20s} score={c["score"]:.1f}  dev={dev:.1f}  cat={c.get("category","?")}  gender={c.get("gender","?")}')

print("\n=== Bottom 10 ===")
for i, c in enumerate(celebrities[-10:]):
    dev = 50 + 10 * (c["score"] - mean) / stdev
    idx = len(celebrities) - 10 + i + 1
    print(f'{idx:3d}. {c["name"]:20s} score={c["score"]:.1f}  dev={dev:.1f}  cat={c.get("category","?")}')

# Category breakdown
cats = {}
for c in celebrities:
    cat = c.get("category", "unknown")
    cats[cat] = cats.get(cat, 0) + 1
print("\nCategories:")
for cat, cnt in sorted(cats.items(), key=lambda x: -x[1]):
    print(f"  {cat}: {cnt}")
