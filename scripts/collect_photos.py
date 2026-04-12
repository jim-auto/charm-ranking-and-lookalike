"""Automatically collect celebrity photos using DuckDuckGo image search.

Usage:
    # Collect photos for all celebrities that need them
    python scripts/collect_photos.py

    # Collect for specific celebrities
    python scripts/collect_photos.py --names "横浜流星" "橋本環奈"

    # Collect more photos per person (default: 3)
    python scripts/collect_photos.py --max-photos 5

    # Only collect for celebrities missing from public data
    python scripts/collect_photos.py --new-only
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import List

import warnings

import requests
from PIL import Image

warnings.filterwarnings("ignore", message=".*renamed.*ddgs.*")

try:
    from duckduckgo_search import DDGS
except ImportError:
    DDGS = None

try:
    from icrawler.builtin import BingImageCrawler
except ImportError:
    BingImageCrawler = None

SCRIPT_DIR = Path(__file__).parent
INPUT_DIR = SCRIPT_DIR / "input_images"
DATA_JSON = SCRIPT_DIR.parent / "web" / "public" / "data" / "celebrities.json"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

MIN_IMAGE_SIZE = 10_000  # 10KB minimum
MAX_IMAGE_SIZE = 10_000_000  # 10MB maximum
MIN_DIMENSION = 200  # minimum width/height in pixels


def existing_photos(folder: Path) -> List[str]:
    if not folder.is_dir():
        return []
    return [f.name for f in folder.iterdir() if f.suffix.lower() in IMAGE_EXTENSIONS]


def search_images_ddgs(query: str, max_results: int = 10) -> List[str]:
    """Search DuckDuckGo for image URLs."""
    if DDGS is None:
        return []
    urls = []
    try:
        with DDGS() as ddgs:
            results = ddgs.images(query, max_results=max_results)
            for r in results:
                url = r.get("image", "")
                if url and url.startswith("http"):
                    urls.append(url)
    except Exception as e:
        print(f"    DDGS error: {e}")
    return urls


def search_images_icrawler(query: str, save_dir: Path, max_results: int = 5) -> List[Path]:
    """Search Bing via icrawler and save images directly."""
    if BingImageCrawler is None:
        return []
    save_dir.mkdir(parents=True, exist_ok=True)
    try:
        crawler = BingImageCrawler(
            storage={"root_dir": str(save_dir)},
            log_level=40,  # ERROR only
        )
        crawler.crawl(keyword=query, max_num=max_results)
        return sorted(save_dir.glob("*"))
    except Exception as e:
        print(f"    icrawler error: {e}")
        return []


def search_images(query: str, max_results: int = 10) -> List[str]:
    """Search for image URLs, trying DDGS first then icrawler."""
    urls = search_images_ddgs(query, max_results)
    if not urls:
        time.sleep(1)
        urls = search_images_ddgs(query, max_results)
    return urls


def download_image(url: str, save_path: Path, timeout: int = 15) -> bool:
    """Download an image and validate it."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, stream=True)
        resp.raise_for_status()

        content_length = int(resp.headers.get("content-length", 0))
        if content_length > MAX_IMAGE_SIZE:
            return False

        data = resp.content
        if len(data) < MIN_IMAGE_SIZE:
            return False

        # Validate it's a real image
        save_path.write_bytes(data)
        try:
            img = Image.open(save_path)
            img.verify()
            img = Image.open(save_path)
            w, h = img.size
            if w < MIN_DIMENSION or h < MIN_DIMENSION:
                save_path.unlink(missing_ok=True)
                return False
            # Convert to RGB JPEG for consistency
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(str(save_path), "JPEG", quality=90)
            return True
        except Exception:
            save_path.unlink(missing_ok=True)
            return False

    except Exception:
        save_path.unlink(missing_ok=True)
        return False


def collect_for_celebrity(
    name: str, folder: Path, max_new: int = 3, existing: List[str] = None
) -> int:
    """Collect photos for a single celebrity."""
    if existing is None:
        existing = existing_photos(folder)

    folder.mkdir(parents=True, exist_ok=True)

    # Search with multiple queries for variety
    queries = [
        f"{name} 顔 正面",
        f"{name} プロフィール写真",
        f"{name} 顔写真",
    ]

    all_urls = []
    for query in queries:
        urls = search_images(query, max_results=8)
        all_urls.extend(urls)
        time.sleep(2)  # rate limiting

    # Deduplicate by URL
    seen = set()
    unique_urls = []
    for url in all_urls:
        url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
        if url_hash not in seen:
            seen.add(url_hash)
            unique_urls.append(url)

    downloaded = 0
    photo_index = len(existing) + 1

    for url in unique_urls:
        if downloaded >= max_new:
            break

        filename = f"photo{photo_index}.jpg" if photo_index > 1 else "photo.jpg"
        if filename in existing:
            photo_index += 1
            filename = f"photo{photo_index}.jpg"

        save_path = folder / filename
        print(f"    Downloading {filename}...", end=" ")

        if download_image(url, save_path):
            print("OK")
            downloaded += 1
            photo_index += 1
        else:
            print("SKIP")

        time.sleep(0.5)

    # Fallback to icrawler if DDGS didn't find enough
    if downloaded < max_new and BingImageCrawler is not None:
        print(f"    Trying icrawler fallback ({max_new - downloaded} more needed)...")
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            found = search_images_icrawler(f"{name} 顔写真", tmp, max_results=max_new * 2)
            for img_path in found:
                if downloaded >= max_new:
                    break
                filename = f"photo{photo_index}.jpg"
                save_path = folder / filename
                try:
                    img = Image.open(img_path)
                    w, h = img.size
                    if w < MIN_DIMENSION or h < MIN_DIMENSION:
                        continue
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    img.save(str(save_path), "JPEG", quality=90)
                    print(f"    Saved {filename} (icrawler)")
                    downloaded += 1
                    photo_index += 1
                except Exception:
                    save_path.unlink(missing_ok=True)

    return downloaded


def load_public_names() -> set:
    if not DATA_JSON.exists():
        return set()
    with open(DATA_JSON, "r", encoding="utf-8") as f:
        return {c["name"] for c in json.load(f)}


def get_all_celebrity_folders() -> List[tuple]:
    """Get all celebrity folders with metadata."""
    results = []
    for folder in sorted(INPUT_DIR.iterdir()):
        if not folder.is_dir():
            continue
        cat_file = folder / "category.txt"
        gender_file = folder / "gender.txt"
        if cat_file.exists():
            cat = cat_file.read_text(encoding="utf-8").strip()
            gender = (
                gender_file.read_text(encoding="utf-8").strip()
                if gender_file.exists()
                else "unknown"
            )
            results.append((folder.name, folder, cat, gender))
    return results


def main():
    parser = argparse.ArgumentParser(description="Collect celebrity photos automatically")
    parser.add_argument("--names", nargs="+", help="Specific celebrity names to collect")
    parser.add_argument(
        "--max-photos", type=int, default=3, help="Max new photos per celebrity"
    )
    parser.add_argument(
        "--new-only",
        action="store_true",
        help="Only collect for celebrities not yet in public data",
    )
    parser.add_argument(
        "--needs-more",
        action="store_true",
        help="Only collect for celebrities with fewer than 2 photos",
    )
    parser.add_argument(
        "--priority",
        nargs="+",
        help="Priority celebrities to process first",
    )
    args = parser.parse_args()

    public_names = load_public_names()

    if args.names:
        targets = []
        for name in args.names:
            folder = INPUT_DIR / name
            targets.append((name, folder))
    else:
        all_folders = get_all_celebrity_folders()
        targets = [(name, folder) for name, folder, _, _ in all_folders]

    if args.new_only:
        targets = [(n, f) for n, f in targets if n not in public_names]

    if args.needs_more:
        targets = [(n, f) for n, f in targets if len(existing_photos(f)) < 2]

    # Move priority names to front
    if args.priority:
        priority_set = set(args.priority)
        priority_targets = [(n, f) for n, f in targets if n in priority_set]
        rest = [(n, f) for n, f in targets if n not in priority_set]
        targets = priority_targets + rest

    print(f"Collecting photos for {len(targets)} celebrities (max {args.max_photos} new each)")
    print()

    total_downloaded = 0
    for name, folder in targets:
        existing = existing_photos(folder)
        in_data = "YES" if name in public_names else "NO"
        print(f"[{name}] ({len(existing)} existing, in_data={in_data})")

        downloaded = collect_for_celebrity(name, folder, args.max_photos, existing)
        total_downloaded += downloaded

        if downloaded == 0:
            print("    No new photos found")
        print()

    print(f"Done! Downloaded {total_downloaded} photos total.")
    print()
    print("Next steps:")
    print("  1. Review downloaded photos (remove bad ones)")
    print("  2. Run: python scripts/process_faces.py")
    print("  3. Run: python scripts/generate_data.py")


if __name__ == "__main__":
    main()
