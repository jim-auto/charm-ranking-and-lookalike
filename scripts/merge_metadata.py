#!/usr/bin/env python3
"""Merge existing metadata (category, age, gender, sns, group) into new celebrities.json.
Also reads category.txt from input_images for new entries."""

import json
import math
import statistics
import sys
from datetime import date, datetime
from pathlib import Path

from ranking_policy import build_ranking_policy, deviation
from score_policy import age_adjusted_score, round_score

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_DIR = SCRIPT_DIR / "input_images"
DATA_DIR = SCRIPT_DIR.parent / "web" / "public" / "data"
META_FILE = SCRIPT_DIR / "meta_backup.json"
WIKIDATA_META_FILE = SCRIPT_DIR / "meta_wikidata.json"
FACE_AUDIT_FILE = SCRIPT_DIR / "face_audit_report.json"

VALID_GENDERS = {"male", "female", "unknown"}
FEMALE_CATEGORIES = {"actress", "idol"}
MALE_CATEGORIES = {"actor", "sumo"}
NAME_GENDER_OVERRIDES = {
    "田中みな実": "female",
    "加藤綾子": "female",
    "安室奈美恵": "female",
    "椎名林檎": "female",
    "浜崎あゆみ": "female",
    "Crystal Kay": "female",
    "中島美嘉": "female",
    "EXILE TAKAHIRO": "male",
    "宮崎駿": "male",
    "池上彰": "male",
    "秋元康": "male",
    "庵野秀明": "male",
    "棚橋弘至": "male",
    "中田敦彦": "male",
    "槇原敬之": "male",
    "小室哲哉": "male",
    "石川佳純": "female",
    "浅田真央": "female",
}
FEMALE_ATHLETE_NAMES = {
    "石川佳純",
    "浅田真央",
    "畑岡奈紗",
    "谷亮子",
    "吉田沙保里",
    "渋野日向子",
    "紀平梨花",
}
FEMALE_COMEDIAN_NAMES = {
    "やす子",
    "ゆりやんレトリィバァ",
}
FEMALE_NAME_SUFFIXES = (
    "子",
    "花",
    "紗",
    "里",
)
MALE_NAME_SUFFIXES = (
    "太",
    "介",
    "郎",
    "司",
    "樹",
    "人",
    "宏",
    "輔",
    "治",
    "磨",
    "誠",
    "平",
    "然",
    "佑",
    "喜",
    "豊",
    "岳",
    "仁",
    "大",
    "地",
    "雄",
    "和",
    "世",
    "洋",
    "弦",
    "晃",
    "生",
    "隆",
    "有",
    "悟",
    "斗",
    "彦",
    "之",
    "哉",
    "尚",
    "駿",
    "彰",
    "康",
    "明",
    "三",
    "ロー",
)


def read_text_if_exists(path: Path) -> str | None:
    if not path.is_file():
        return None
    value = path.read_text(encoding="utf-8").strip()
    return value or None


def load_json_if_exists(path: Path) -> dict:
    if not path.is_file():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_face_audit_entries(path: Path) -> dict[str, dict]:
    data = load_json_if_exists(path)
    entries = data.get("entries")
    if not isinstance(entries, list):
        return {}
    return {
        entry["name"]: entry
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("name"), str)
    }


def calculate_age_from_birth_date(value: str | None) -> int | None:
    if not value:
        return None
    try:
        birth = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None

    today = date.today()
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def normalize_gender(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower()
    return lowered if lowered in VALID_GENDERS else None


def infer_gender_from_name(name: str) -> str | None:
    compact = name.replace(" ", "").replace("　", "")
    if compact in NAME_GENDER_OVERRIDES:
        return NAME_GENDER_OVERRIDES[compact]
    for suffix in FEMALE_NAME_SUFFIXES:
        if compact.endswith(suffix):
            return "female"
    for suffix in MALE_NAME_SUFFIXES:
        if compact.endswith(suffix):
            return "male"
    return None


def infer_gender(name: str, category: str, existing_gender: str | None) -> str:
    if existing_gender in {"male", "female"}:
        return existing_gender

    if name in NAME_GENDER_OVERRIDES:
        return NAME_GENDER_OVERRIDES[name]

    if category in FEMALE_CATEGORIES:
        return "female"
    if category in MALE_CATEGORIES:
        return "male"

    if category == "announcer":
        return NAME_GENDER_OVERRIDES.get(name, "unknown")

    if category == "athlete":
        if name in FEMALE_ATHLETE_NAMES:
            return "female"
        return infer_gender_from_name(name) or "male"

    if category == "comedian":
        if name in FEMALE_COMEDIAN_NAMES:
            return "female"
        return infer_gender_from_name(name) or "male"

    if category in {"artist", "cultural", "musician", "prowrestler", "youtuber"}:
        guessed = infer_gender_from_name(name)
        if guessed:
            return guessed

    return existing_gender or "unknown"

# Load current data
with open(DATA_DIR / "celebrities.json", "r", encoding="utf-8") as f:
    celebrities = json.load(f)

# Load metadata sources
meta_backup = load_json_if_exists(META_FILE)
meta_wikidata = load_json_if_exists(WIKIDATA_META_FILE)
face_audit_entries = load_face_audit_entries(FACE_AUDIT_FILE)

updated = 0
for cel in celebrities:
    name = cel["name"]
    category_from_file = read_text_if_exists(INPUT_DIR / name / "category.txt")
    gender_from_file = normalize_gender(read_text_if_exists(INPUT_DIR / name / "gender.txt"))

    # Apply saved metadata
    merged_meta = {}
    if name in meta_wikidata:
        merged_meta.update(meta_wikidata[name])
    if name in meta_backup:
        merged_meta.update(meta_backup[name])

    if merged_meta:
        m = merged_meta
        for key in ("category", "age", "gender", "sns", "totalFollowers", "group"):
            if key in m and (key not in cel or (key == "category" and cel.get("category") == "actor")):
                cel[key] = m[key]
        if "birthDate" in m and "birthDate" not in cel:
            cel["birthDate"] = m["birthDate"]
        updated += 1

    if category_from_file:
        cel["category"] = category_from_file
    if gender_from_file:
        cel["gender"] = gender_from_file

    computed_age = calculate_age_from_birth_date(cel.get("birthDate"))
    if computed_age is not None:
        cel["age"] = computed_age

    cel["gender"] = infer_gender(
        name=name,
        category=cel.get("category", ""),
        existing_gender=normalize_gender(cel.get("gender")),
    )

    audit_entry = face_audit_entries.get(name)
    if audit_entry:
        reason = audit_entry.get("reason", "unknown")
        if audit_entry.get("status") == "accepted":
            cel["faceValidationStatus"] = "accepted"
            cel.pop("faceValidationReason", None)
        elif reason == "no_face_detected":
            cel["faceValidationStatus"] = "undetected"
            cel["faceValidationReason"] = reason
        else:
            cel["faceValidationStatus"] = "rejected"
            cel["faceValidationReason"] = reason

        source = audit_entry.get("source")
        if source:
            cel["faceValidationSource"] = source
        else:
            cel.pop("faceValidationSource", None)

    # Recalculate score variants
    score = cel["score"]
    cel["scores"] = {"face": score}

    # Age adjustment
    cel["scores"]["faceAge"] = age_adjusted_score(score, cel.get("age"))

    # SNS adjustment
    if "totalFollowers" in cel and cel["totalFollowers"] > 0:
        sns_score = min(100, math.log10(max(1, cel["totalFollowers"])) * 10)
        cel["scores"]["faceSns"] = round_score(score * 0.7 + sns_score * 0.3)
        cel["scores"]["faceAgeSns"] = round_score(cel["scores"]["faceAge"] * 0.7 + sns_score * 0.3)
    else:
        cel["scores"]["faceSns"] = round_score(score)
        cel["scores"]["faceAgeSns"] = cel["scores"]["faceAge"]

policy_by_name, stats = build_ranking_policy(celebrities)
excluded_count = 0
for cel in celebrities:
    policy = policy_by_name[cel["name"]]
    cel["rankingEligible"] = policy["rankingEligible"]
    if policy["rankingExclusionReasons"]:
        cel["rankingExclusionReasons"] = policy["rankingExclusionReasons"]
        excluded_count += 1
    else:
        cel.pop("rankingExclusionReasons", None)

# Re-rank
celebrities.sort(key=lambda c: c["score"], reverse=True)
for rank, cel in enumerate(celebrities, start=1):
    cel["rank"] = rank

# Save
with open(DATA_DIR / "celebrities.json", "w", encoding="utf-8") as f:
    json.dump(celebrities, f, ensure_ascii=False, indent=2)

print(f"Updated {updated} entries with existing metadata")
print(f"Total: {len(celebrities)} celebrities")
print(f"Recommended ranking exclusions: {excluded_count}")

# Print distribution
scores = [c["score"] for c in celebrities]
mean = stats["mean"] if scores else 0.0
stdev = stats["stdev"] if scores else 0.0
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
