#!/usr/bin/env python3
"""Remove photo-biased entries from scripts/input_images.

The cleanup rules combine:
1. Manually specified names that should always be removed.
2. Any top-50 entry in celebrities.json whose category is one of
   comedian/athlete/sumo/cultural.
3. Any actor/actress/idol whose deviation score is 40 or lower.
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import sys
from collections import defaultdict
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_INPUT_DIR = SCRIPT_DIR / "input_images"
DEFAULT_CELEBRITIES_JSON = PROJECT_ROOT / "web" / "public" / "data" / "celebrities.json"

MANUAL_NAMES = (
    "松岡茉優",
    "藤本敏史",
    "赤星貴文",
    "吉田麻也",
    "野村忠宏",
    "古田敦也",
    "松山英樹",
    "タモリ",
    "ミルクボーイ駒場",
    "金田正一",
    "宮崎駿",
    "アンタ山崎",
    "三浦知良",
    "川島永嗣",
    "錦鯉長谷川",
    "坂本龍一",
    "爆笑問題田中裕二",
    "長谷川穂積",
)
UNWANTED_TOP_CATEGORIES = {"comedian", "athlete", "sumo", "cultural"}
LOW_DEVIATION_CATEGORIES = {"actor", "actress", "idol"}
TOP_LIMIT = 50
LOW_DEVIATION_THRESHOLD = 40.0


def load_celebrities(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def deviation(score: float, mean: float, stdev: float) -> float:
    if stdev == 0:
        return 50.0
    return 50 + 10 * (score - mean) / stdev


def describe_entry(entry: dict, mean: float, stdev: float) -> str:
    rank = entry.get("rank", "?")
    category = entry.get("category", "?")
    score = entry.get("score", 0.0)
    dev = deviation(score, mean, stdev)
    return f"rank={rank} score={score:.1f} dev={dev:.1f} cat={category}"


def collect_candidates(celebrities: list[dict]) -> dict[str, list[str]]:
    scores = [entry["score"] for entry in celebrities]
    mean = statistics.mean(scores)
    stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0
    by_name = {entry["name"]: entry for entry in celebrities}
    sorted_by_score = sorted(celebrities, key=lambda entry: entry["score"], reverse=True)

    reasons: dict[str, list[str]] = defaultdict(list)

    for name in MANUAL_NAMES:
        entry = by_name.get(name)
        if entry is None:
            reasons[name].append("manual target (not found in celebrities.json)")
            continue
        reasons[name].append(f"manual target ({describe_entry(entry, mean, stdev)})")

    for entry in sorted_by_score[:TOP_LIMIT]:
        category = entry.get("category")
        if category not in UNWANTED_TOP_CATEGORIES:
            continue
        reasons[entry["name"]].append(
            f"top{TOP_LIMIT} unwanted category ({describe_entry(entry, mean, stdev)})"
        )

    survivors = 0
    for entry in sorted_by_score:
        category = entry.get("category")
        if category in UNWANTED_TOP_CATEGORIES:
            reasons[entry["name"]].append(
                f"blocks clean top{TOP_LIMIT} after re-ranking ({describe_entry(entry, mean, stdev)})"
            )
            continue
        survivors += 1
        if survivors >= TOP_LIMIT:
            break

    for entry in sorted_by_score:
        category = entry.get("category")
        if category not in LOW_DEVIATION_CATEGORIES:
            continue
        dev = deviation(entry["score"], mean, stdev)
        if dev > LOW_DEVIATION_THRESHOLD:
            continue
        reasons[entry["name"]].append(
            f"low deviation <= {LOW_DEVIATION_THRESHOLD:.1f} ({describe_entry(entry, mean, stdev)})"
        )

    return dict(sorted(reasons.items(), key=lambda item: item[0]))


def validate_target(input_root: Path, name: str) -> Path:
    target = (input_root / name).resolve()
    root = input_root.resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Refusing to delete path outside input root: {target}") from exc
    return target


def remove_targets(
    input_root: Path,
    candidates: dict[str, list[str]],
    dry_run: bool,
) -> tuple[list[str], list[str]]:
    removed: list[str] = []
    missing: list[str] = []

    for name in candidates:
        target = validate_target(input_root, name)
        if not target.exists():
            missing.append(name)
            continue
        if not target.is_dir():
            raise ValueError(f"Expected a directory but found something else: {target}")
        if dry_run:
            removed.append(name)
            continue
        shutil.rmtree(target)
        removed.append(name)

    return removed, missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=DEFAULT_INPUT_DIR,
        help=f"Directory containing input images (default: {DEFAULT_INPUT_DIR})",
    )
    parser.add_argument(
        "--celebrities-json",
        type=Path,
        default=DEFAULT_CELEBRITIES_JSON,
        help=f"Source celebrities.json (default: {DEFAULT_CELEBRITIES_JSON})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report candidates without deleting any directories.",
    )
    args = parser.parse_args()

    celebrities = load_celebrities(args.celebrities_json)
    candidates = collect_candidates(celebrities)
    removed, missing = remove_targets(args.input_dir, candidates, args.dry_run)

    mode = "Dry run" if args.dry_run else "Applied"
    print(f"{mode}: {len(candidates)} cleanup candidates")
    print(f"Source: {args.celebrities_json}")
    print(f"Input : {args.input_dir}")

    for name, reasons in candidates.items():
        status = "MISSING"
        if name in removed and name not in missing:
            status = "WOULD_REMOVE" if args.dry_run else "REMOVED"
        elif name in missing:
            status = "MISSING"
        print(f"\n[{status}] {name}")
        for reason in reasons:
            print(f"  - {reason}")

    print("\nSummary")
    print(f"  candidates: {len(candidates)}")
    print(f"  {'would remove' if args.dry_run else 'removed'}: {len(removed)}")
    print(f"  missing: {len(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
