#!/usr/bin/env python3
"""
strip_exif.py - Remove EXIF (and other metadata) from images for privacy.

Walks a directory tree and re-saves every JPEG/PNG image without
metadata.  Original files are overwritten in place unless --output-dir
is specified.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def strip_exif(src: Path, dst: Path) -> bool:
    """Strip all metadata from *src* and save to *dst*.

    Returns True on success, False on error.
    """
    try:
        img = Image.open(src)

        # Create a clean copy without metadata
        clean = Image.new(img.mode, img.size)
        clean.putdata(list(img.getdata()))

        # Determine save parameters
        ext = dst.suffix.lower()
        if ext in {".jpg", ".jpeg"}:
            clean.save(str(dst), "JPEG", quality=95)
        elif ext == ".png":
            clean.save(str(dst), "PNG")
        elif ext == ".webp":
            clean.save(str(dst), "WEBP", quality=95)
        elif ext == ".bmp":
            clean.save(str(dst), "BMP")
        else:
            clean.save(str(dst))

        return True
    except Exception as exc:
        print(f"  ERROR: {src} -> {exc}", file=sys.stderr)
        return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Strip EXIF and other metadata from images."
    )
    parser.add_argument(
        "directory",
        type=str,
        help="Directory containing images (searched recursively)",
    )
    parser.add_argument(
        "-o", "--output-dir",
        type=str,
        default=None,
        help="Output directory (preserves relative structure). "
             "If omitted, files are overwritten in place.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List files that would be processed without modifying them",
    )
    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Suppress per-file output",
    )
    args = parser.parse_args()

    root = Path(args.directory).resolve()
    if not root.is_dir():
        print(f"Error: not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    out_root = Path(args.output_dir).resolve() if args.output_dir else None

    images = sorted(
        p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS
    )

    if not images:
        print(f"No images found in {root}")
        return

    print(f"Found {len(images)} image(s) in {root}")

    success = 0
    failed = 0

    for img_path in images:
        rel = img_path.relative_to(root)

        if out_root:
            dst = out_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
        else:
            dst = img_path

        if args.dry_run:
            print(f"  [DRY-RUN] {rel}")
            success += 1
            continue

        ok = strip_exif(img_path, dst)
        if ok:
            success += 1
            if not args.quiet:
                print(f"  Stripped: {rel}")
        else:
            failed += 1

    print(f"\nDone. {success} processed, {failed} failed.")


if __name__ == "__main__":
    main()
