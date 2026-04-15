#!/usr/bin/env python3
"""Build new-genre target files from PLAN.md without relying on shell encoding."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
PLAN_PATH = ROOT_DIR / "PLAN.md"
MANIFEST_PATH = ROOT_DIR / "scripts" / "new_genres_manifest.json"
NAMES_PATH = ROOT_DIR / "scripts" / "new_genres_names.txt"

LINE_CATEGORY_MAP = {
    1: "announcer",
    2: "voiceactor",
    3: "model",
    4: "business",
    5: "politician",
    6: "artist",
    7: "shogi",
}

MALE_NAMES = {
    "\u68b6\u88d5\u8cb4",  # 梶裕貴
    "\u4e0b\u91ce\u7d18",  # 下野紘
    "\u524d\u6fa4\u53cb\u4f5c",  # 前澤友作
    "\u5800\u6c5f\u8cb4\u6587",  # 堀江貴文
    "\u5c0f\u6cc9\u9032\u6b21\u90ce",  # 小泉進次郎
    "\u307e\u3075\u307e\u3075",  # まふまふ
    "\u85e4\u4e95\u8061\u592a",  # 藤井聡太
}

FEMALE_NAMES = {
    "\u84ee\u8217",  # 蓮舫
}


def extract_targets(plan_text: str) -> list[dict[str, str]]:
    section = plan_text.split("### Genres to add", 1)[1].split("### How to add them", 1)[0]
    pattern = re.compile(r"^(\d+)\.\s+\*\*.*?\*\*\s+—\s+(.*)$")
    targets: list[dict[str, str]] = []

    for raw_line in section.splitlines():
        line = raw_line.strip()
        match = pattern.match(line)
        if not match:
            continue

        line_number = int(match.group(1))
        names = [
            value.strip()
            for value in match.group(2).replace(" etc.", "").split(",")
            if value.strip()
        ]
        category = LINE_CATEGORY_MAP[line_number]

        for name in names:
            gender = "female"
            if name in MALE_NAMES:
                gender = "male"
            elif name in FEMALE_NAMES:
                gender = "female"

            targets.append(
                {
                    "name": name,
                    "category": category,
                    "gender": gender,
                }
            )

    return targets


def main() -> None:
    plan_text = PLAN_PATH.read_text(encoding="utf-8")
    targets = extract_targets(plan_text)

    if len(targets) != 24:
        raise ValueError(f"Expected 24 targets from PLAN.md, got {len(targets)}")

    NAMES_PATH.write_text(
        "".join(f"{entry['name']}\n" for entry in targets),
        encoding="utf-8",
    )
    MANIFEST_PATH.write_text(
        json.dumps(targets, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(targets)} names to {NAMES_PATH}")
    print(f"Wrote manifest to {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
