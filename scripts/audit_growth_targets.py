#!/usr/bin/env python3
"""Audit a target manifest against public data, local input dirs, and metadata cache."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def has_photo_file(path: Path) -> bool:
    for name in ("photo.jpg", "photo.jpeg", "photo.png", "photo.webp"):
        file_path = path / name
        if file_path.exists() and file_path.stat().st_size > 10_000:
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        default="scripts/mainstream_jp_targets.json",
        help="Path to target manifest JSON",
    )
    parser.add_argument(
        "--public-data",
        default="web/public/data/celebrities.json",
        help="Path to public celebrities.json",
    )
    parser.add_argument(
        "--input-dir",
        default="scripts/input_images",
        help="Directory containing input image subdirectories",
    )
    parser.add_argument(
        "--meta-cache",
        default="scripts/meta_wikidata.json",
        help="Path to Wikidata metadata cache",
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    public_path = Path(args.public_data)
    input_dir = Path(args.input_dir)
    meta_path = Path(args.meta_cache)

    targets = load_json(manifest_path)
    public = load_json(public_path)
    meta = load_json(meta_path) if meta_path.exists() else {}

    public_names = {entry["name"] for entry in public}
    duplicates = [name for name, count in Counter(t["name"] for t in targets).items() if count > 1]
    if duplicates:
      raise SystemExit(f"duplicate target names: {', '.join(sorted(duplicates))}")

    rows = []
    by_category = defaultdict(lambda: Counter())
    for target in targets:
        name = target["name"]
        category = target["category"]
        person_dir = input_dir / name
        in_public = name in public_names
        dir_exists = person_dir.exists()
        has_photo = dir_exists and has_photo_file(person_dir)
        has_meta = name in meta

        if in_public:
            status = "public"
        elif has_photo:
            status = "pending_with_photo"
        elif dir_exists:
            status = "pending_stub"
        else:
            status = "missing"

        rows.append(
            {
                **target,
                "inPublic": in_public,
                "hasInputDir": dir_exists,
                "hasPhoto": has_photo,
                "hasMetadata": has_meta,
                "status": status,
            }
        )
        by_category[category][status] += 1
        by_category[category]["total"] += 1

    summary = Counter(row["status"] for row in rows)
    summary["total"] = len(rows)
    summary["metadata_ready"] = sum(1 for row in rows if row["hasMetadata"])

    stem = manifest_path.stem
    report_path = manifest_path.with_name(f"{stem}_coverage_report.json")
    pending_json_path = manifest_path.with_name(f"{stem}_pending.json")
    pending_txt_path = manifest_path.with_name(f"{stem}_pending.txt")
    pending_photo_json_path = manifest_path.with_name(f"{stem}_pending_with_photo.json")
    pending_photo_txt_path = manifest_path.with_name(f"{stem}_pending_with_photo.txt")
    names_txt_path = manifest_path.with_name(f"{stem}.txt")

    report = {
        "manifest": str(manifest_path),
        "summary": summary,
        "byCategory": {key: dict(value) for key, value in sorted(by_category.items())},
        "targets": rows,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    pending_rows = [row for row in rows if not row["inPublic"]]
    pending_json_path.write_text(
        json.dumps(pending_rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    pending_txt_path.write_text(
        "\n".join(row["name"] for row in pending_rows) + ("\n" if pending_rows else ""),
        encoding="utf-8",
    )

    pending_photo_rows = [row for row in pending_rows if row["hasPhoto"]]
    pending_photo_json_path.write_text(
        json.dumps(pending_photo_rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    pending_photo_txt_path.write_text(
        "\n".join(row["name"] for row in pending_photo_rows)
        + ("\n" if pending_photo_rows else ""),
        encoding="utf-8",
    )

    names_txt_path.write_text(
        "\n".join(row["name"] for row in rows) + ("\n" if rows else ""),
        encoding="utf-8",
    )

    print(f"manifest: {manifest_path}")
    print(f"targets: {summary['total']}")
    print(f"public: {summary['public']}")
    print(f"pending_with_photo: {summary['pending_with_photo']}")
    print(f"pending_stub: {summary['pending_stub']}")
    print(f"missing: {summary['missing']}")
    print(f"metadata_ready: {summary['metadata_ready']}")
    print()
    for category, counts in sorted(by_category.items()):
        print(
            f"{category}\t{counts['public']}\t{counts['pending_with_photo']}\t"
            f"{counts['pending_stub']}\t{counts['missing']}\t{counts['total']}"
        )
    print()
    print(f"wrote: {report_path}")
    print(f"wrote: {pending_json_path}")
    print(f"wrote: {pending_txt_path}")
    print(f"wrote: {pending_photo_json_path}")
    print(f"wrote: {pending_photo_txt_path}")
    print(f"wrote: {names_txt_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
