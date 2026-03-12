#!/usr/bin/env python3
"""
generate_data.py - Convenience wrapper around process_faces.py.

Runs face processing on ``input_images/`` and writes the results
directly into ``../web/public/data/`` so the Next.js front-end can
consume them.

Also generates a binary embeddings file (float32) compatible with
face-api.js-style loading.
"""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = SCRIPT_DIR / "input_images"
DEFAULT_OUTPUT = SCRIPT_DIR.parent / "web" / "public" / "data"


def write_binary_embeddings(celebrities: list[dict], out_path: Path) -> None:
    """Write all 128-dim embeddings as a flat float32 binary file.

    Layout:
        4 bytes  - uint32 LE : number of entries (N)
        4 bytes  - uint32 LE : embedding dimension (128)
        N * 128 * 4 bytes    : float32 LE values

    This matches the format expected by face-api.js for fast loading
    via Float32Array.
    """
    dim = 128
    n = len(celebrities)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<II", n, dim))
        for cel in celebrities:
            emb = cel["embedding"]
            if len(emb) != dim:
                raise ValueError(
                    f"Embedding for {cel['name']} has {len(emb)} dims, expected {dim}"
                )
            f.write(struct.pack(f"<{dim}f", *emb))
    print(f"Binary embeddings written: {out_path}  ({n} entries, {out_path.stat().st_size} bytes)")


def write_embedding_index(celebrities: list[dict], out_path: Path) -> None:
    """Write a JSON index mapping celebrity id -> offset in the binary file.

    This allows the front-end to look up an embedding by id without
    loading the full file into memory.
    """
    index = {}
    for i, cel in enumerate(celebrities):
        index[cel["id"]] = {
            "index": i,
            "name": cel["name"],
        }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"Embedding index written: {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate web-ready data from celebrity face images."
    )
    parser.add_argument(
        "-i", "--input-dir",
        type=str,
        default=str(DEFAULT_INPUT),
        help=f"Input image directory (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "-o", "--output-dir",
        type=str,
        default=str(DEFAULT_OUTPUT),
        help=f"Output data directory (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--model",
        choices=["hog", "cnn"],
        default="hog",
        help="Face detection model (default: hog)",
    )
    parser.add_argument(
        "--thumb-size",
        type=int,
        default=200,
        help="Thumbnail size in pixels (default: 200)",
    )
    parser.add_argument(
        "--category-file",
        type=str,
        default=None,
        help="Optional JSON file mapping name -> category",
    )
    parser.add_argument(
        "--skip-processing",
        action="store_true",
        help="Skip face processing; only regenerate binary embeddings from existing celebrities.json",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    celebrities_json = output_dir / "celebrities.json"

    # ---------------------------------------------------------------
    # Step 1: Run process_faces.py (unless skipped)
    # ---------------------------------------------------------------
    if not args.skip_processing:
        cmd = [
            sys.executable,
            str(SCRIPT_DIR / "process_faces.py"),
            "--input-dir", str(input_dir),
            "--output-dir", str(output_dir),
            "--thumb-size", str(args.thumb_size),
            "--model", args.model,
        ]
        if args.category_file:
            cmd.extend(["--category-file", args.category_file])

        print("=" * 60)
        print("Running process_faces.py ...")
        print(f"  Input:  {input_dir}")
        print(f"  Output: {output_dir}")
        print("=" * 60)

        result = subprocess.run(cmd)
        if result.returncode != 0:
            print("process_faces.py failed.", file=sys.stderr)
            sys.exit(result.returncode)

    # ---------------------------------------------------------------
    # Step 2: Generate binary embeddings
    # ---------------------------------------------------------------
    if not celebrities_json.is_file():
        print(f"Error: {celebrities_json} not found.", file=sys.stderr)
        sys.exit(1)

    with open(celebrities_json, "r", encoding="utf-8") as f:
        celebrities = json.load(f)

    print(f"\nLoaded {len(celebrities)} celebrities from {celebrities_json}")

    embeddings_bin = output_dir / "embeddings.bin"
    write_binary_embeddings(celebrities, embeddings_bin)

    embeddings_index = output_dir / "embeddings_index.json"
    write_embedding_index(celebrities, embeddings_index)

    # ---------------------------------------------------------------
    # Step 3: Write a slim version without embeddings for fast loading
    # ---------------------------------------------------------------
    slim = []
    for cel in celebrities:
        slim.append({
            "id": cel["id"],
            "name": cel["name"],
            "category": cel.get("category", "actor"),
            "score": cel["score"],
            "details": cel["details"],
            "thumbnail": cel["thumbnail"],
        })

    slim_path = output_dir / "celebrities_slim.json"
    with open(slim_path, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, indent=2)
    print(f"Slim JSON (no embeddings) written: {slim_path}")

    print("\nAll done.")


if __name__ == "__main__":
    main()
