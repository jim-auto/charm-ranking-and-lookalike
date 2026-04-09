#!/usr/bin/env python3
"""Download portrait candidates from Wikimedia Commons for a manifest of celebrities."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import unicodedata
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


ROLE_HINTS = {
    "actor": "actor",
    "actress": "actress",
    "idol": "idol",
    "artist": "singer",
    "musician": "musician",
    "influencer": "model",
    "youtuber": "YouTuber",
    "comedian": "comedian",
    "athlete": "athlete",
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_match_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(ch for ch in normalized if ch.isalnum())


def build_title_needles(entry: dict) -> list[str]:
    raw_values = [entry.get("name", ""), entry.get("wikipediaTitle", "")]
    needles: list[str] = []
    for value in raw_values:
        if not value:
            continue
        compact = normalize_match_text(value)
        if compact and compact not in needles:
            needles.append(compact)
        for token in re.split(r"[\s()（）・/]+", value):
            compact_token = normalize_match_text(token)
            if len(compact_token) >= 4 and compact_token not in needles:
                needles.append(compact_token)
    return needles


def title_looks_relevant(entry: dict, title: str) -> bool:
    normalized_title = normalize_match_text(title)
    needles = build_title_needles(entry)
    if not needles:
        return True
    return any(needle in normalized_title for needle in needles)


def fetch_commons_file_info(title: str) -> dict | None:
    params = {
        "action": "query",
        "titles": title,
        "prop": "imageinfo",
        "iiprop": "url|mime|size",
        "iiurlwidth": "1200",
        "format": "json",
    }
    url = f"https://commons.wikimedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        imageinfo = page.get("imageinfo")
        if not imageinfo:
            continue
        info = imageinfo[0]
        mime = info.get("mime", "")
        if not mime.startswith("image/") or "svg" in mime:
            continue
        width = info.get("width", 0)
        height = info.get("height", 0)
        if width < 160 or height < 200:
            continue
        return {
            "title": page.get("title", title),
            "url": info.get("thumburl") or info.get("url"),
            "width": width,
            "height": height,
            "size": info.get("size", 0),
            "source": "commons-file",
        }
    return None


def fetch_wikipedia_page_image(title: str, language: str = "ja") -> dict | None:
    params = {
        "action": "query",
        "titles": title,
        "prop": "pageimages",
        "piprop": "thumbnail|name",
        "pithumbsize": "1200",
        "format": "json",
    }
    url = f"https://{language}.wikipedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        thumb = page.get("thumbnail")
        if not thumb:
            continue
        source = thumb.get("source")
        width = thumb.get("width", 0)
        height = thumb.get("height", 0)
        if not source or width < 160 or height < 200:
            continue
        return {
            "title": page.get("title", title),
            "url": source,
            "width": width,
            "height": height,
            "size": width * height,
            "source": f"{language}wiki-pageimage",
        }
    return None


def search_commons(query: str) -> list[dict]:
    params = {
        "action": "query",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrsearch": query,
        "gsrlimit": "20",
        "prop": "imageinfo",
        "iiprop": "url|mime|size",
        "iiurlwidth": "900",
        "format": "json",
    }
    url = f"https://commons.wikimedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    pages = data.get("query", {}).get("pages", {})
    results = []
    for page in pages.values():
        imageinfo = page.get("imageinfo")
        if not imageinfo:
            continue
        title = page["title"]
        lower_title = title.lower()
        if lower_title.endswith((".djvu", ".pdf", ".svg")):
            continue
        info = imageinfo[0]
        mime = info.get("mime", "")
        if not mime.startswith("image/") or "svg" in mime:
            continue
        width = info.get("width", 0)
        height = info.get("height", 0)
        if width < 160 or height < 200:
            continue
        results.append(
            {
                "title": title,
                "url": info.get("thumburl") or info.get("url"),
                "width": width,
                "height": height,
                "size": info.get("size", 0),
                "source": "commons-search",
            }
        )

    results.sort(
        key=lambda item: (
            1 if item["height"] > item["width"] * 0.82 else 0,
            1 if item["height"] >= 520 else 0,
            item["size"],
        ),
        reverse=True,
    )
    return results


def fetch_wikidata_media_candidates(wikidata_id: str) -> list[dict]:
    params = {
        "action": "wbgetentities",
        "ids": wikidata_id,
        "props": "claims",
        "format": "json",
    }
    url = f"https://www.wikidata.org/w/api.php?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    entity = data.get("entities", {}).get(wikidata_id, {})
    claims = entity.get("claims", {})
    p18_claims = claims.get("P18", [])
    candidates: list[dict] = []
    for claim in p18_claims:
        value = (
            claim.get("mainsnak", {})
            .get("datavalue", {})
            .get("value")
        )
        if not isinstance(value, str):
            continue
        info = fetch_commons_file_info(f"File:{value}")
        if info:
            info["source"] = "wikidata-p18"
            candidates.append(info)
    return candidates


def download_image(url: str, path: Path) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        path.write_bytes(resp.read())
    return True


def photo_exists(person_dir: Path, min_bytes: int) -> bool:
    photo = person_dir / "photo.jpg"
    return photo.exists() and photo.stat().st_size >= min_bytes


def candidate_queries(entry: dict) -> list[str]:
    queries = []
    if entry.get("query"):
        queries.append(entry["query"])
    if entry.get("wikipediaTitle"):
        queries.append(entry["wikipediaTitle"])
    name = entry["name"]
    role = ROLE_HINTS.get(entry.get("category", ""))
    if role:
        queries.append(f"{name} {role}")
    queries.append(name)

    deduped = []
    for query in queries:
        if query not in deduped:
            deduped.append(query)
    return deduped


def write_seed_files(person_dir: Path, entry: dict) -> None:
    person_dir.mkdir(parents=True, exist_ok=True)
    (person_dir / "category.txt").write_text(entry["category"], encoding="utf-8")
    if entry.get("gender"):
        (person_dir / "gender.txt").write_text(entry["gender"], encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        default="scripts/mainstream_jp_targets_pending.json",
        help="Manifest JSON path",
    )
    parser.add_argument(
        "--input-dir",
        default="scripts/input_images",
        help="Input image root directory",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of targets to attempt (0 = all)",
    )
    parser.add_argument(
        "--sleep-sec",
        type=float,
        default=3.5,
        help="Seconds to sleep between people",
    )
    parser.add_argument(
        "--min-bytes",
        type=int,
        default=10_000,
        help="Minimum size for an existing photo to count as present",
    )
    parser.add_argument(
        "--only-missing-photo",
        action="store_true",
        help="Skip entries that already have a sufficiently large photo.jpg",
    )
    parser.add_argument(
        "--overwrite-existing",
        action="store_true",
        help="Overwrite existing photo.jpg when a target is explicitly refreshed.",
    )
    parser.add_argument(
        "--names-file",
        default=None,
        help="Optional UTF-8 text file with one target name per line to process.",
    )
    parser.add_argument(
        "--meta-cache",
        default="scripts/meta_wikidata.json",
        help="Optional Wikidata cache JSON used for wikipediaTitle fallback.",
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    input_dir = Path(args.input_dir)
    entries = load_json(manifest_path)
    meta_cache_path = Path(args.meta_cache)
    meta_cache = load_json(meta_cache_path) if meta_cache_path.exists() else {}

    if args.names_file:
        target_names = {
            line.strip()
            for line in Path(args.names_file).read_text(encoding="utf-8-sig").splitlines()
            if line.strip()
        }
        entries = [entry for entry in entries if entry["name"] in target_names]

    if args.limit > 0:
        entries = entries[: args.limit]

    success = 0
    skipped = 0
    failed: list[str] = []

    for index, entry in enumerate(entries, start=1):
        meta = meta_cache.get(entry["name"])
        if meta:
            hydrated = dict(entry)
            if meta.get("wikipediaTitle") and not hydrated.get("wikipediaTitle"):
                hydrated["wikipediaTitle"] = meta["wikipediaTitle"]
            if meta.get("wikidataId") and not hydrated.get("wikidataId"):
                hydrated["wikidataId"] = meta["wikidataId"]
            entry = hydrated
        person_dir = input_dir / entry["name"]
        write_seed_files(person_dir, entry)
        photo_path = person_dir / "photo.jpg"

        if (
            args.only_missing_photo
            and not args.overwrite_existing
            and photo_exists(person_dir, args.min_bytes)
        ):
            print(f"[{index}/{len(entries)}] {entry['name']} - skip (photo exists)")
            skipped += 1
            continue

        print(f"[{index}/{len(entries)}] {entry['name']}")
        results = []
        last_error = None
        if entry.get("wikipediaTitle"):
            for language in ("ja", "en"):
                try:
                    page_image = fetch_wikipedia_page_image(entry["wikipediaTitle"], language=language)
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    print(f"  pageimage error ({language}): {exc}")
                    continue
                if page_image:
                    print(
                        f"  pageimage: {language}wiki "
                        f"{page_image['width']}x{page_image['height']} {page_image['title']}"
                    )
                    results = [page_image]
                    break

        if not results and entry.get("wikidataId"):
            try:
                wikidata_results = fetch_wikidata_media_candidates(entry["wikidataId"])
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                print(f"  wikidata error: {exc}")
            else:
                if wikidata_results:
                    candidate = wikidata_results[0]
                    print(
                        f"  wikidata: {candidate['width']}x{candidate['height']} "
                        f"{candidate['title']}"
                    )
                    results = wikidata_results

        if not results:
            for query in candidate_queries(entry):
                print(f"  query: {query}")
                try:
                    results = [
                        candidate
                        for candidate in search_commons(query)
                        if title_looks_relevant(entry, candidate["title"])
                    ]
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    print(f"  search error: {exc}")
                    continue
                if results:
                    break

        if not results:
            if last_error:
                print(f"  no usable results ({last_error})")
            else:
                print("  no usable results")
            failed.append(entry["name"])
            time.sleep(args.sleep_sec)
            continue

        downloaded = False
        for candidate in results[:5]:
            print(
                f"  try: {candidate['width']}x{candidate['height']} "
                f"{candidate['title']}"
            )
            try:
                tmp_path = photo_path.with_suffix(".tmp")
                download_image(candidate["url"], tmp_path)
                size_kb = tmp_path.stat().st_size // 1024
                tmp_path.replace(photo_path)
                print(f"  downloaded: {size_kb}KB")
                downloaded = True
                break
            except Exception as exc:  # noqa: BLE001
                print(f"  download error: {exc}")

        if downloaded:
            success += 1
        else:
            failed.append(entry["name"])
        time.sleep(args.sleep_sec)

    print()
    print(f"success: {success}")
    print(f"skipped: {skipped}")
    print(f"failed: {len(failed)}")
    if failed:
        print("failed_names:")
        for name in failed:
            print(name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
