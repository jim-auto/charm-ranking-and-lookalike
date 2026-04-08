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
PUBLIC_CELEBRITIES_JSON = "celebrities.json"


def load_json(path: Path) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def has_embeddings(celebrities: list[dict]) -> bool:
    return bool(celebrities) and all("embedding" in cel for cel in celebrities)


def strip_embeddings(celebrities: list[dict]) -> list[dict]:
    return [
        {key: value for key, value in cel.items() if key != "embedding"}
        for cel in celebrities
    ]


def inflate_embeddings(
    celebrities: list[dict],
    embeddings_bin_path: Path,
    embeddings_index_path: Path,
) -> list[dict]:
    if not celebrities:
        return []

    index = load_json(embeddings_index_path)

    with open(embeddings_bin_path, "rb") as f:
        header = f.read(8)
        if len(header) != 8:
            raise ValueError(f"{embeddings_bin_path} is too small")
        count, dim = struct.unpack("<II", header)
        payload = f.read()

    expected_size = count * dim * 4
    if len(payload) != expected_size:
        raise ValueError(
            f"{embeddings_bin_path} has {len(payload)} payload bytes, expected {expected_size}"
        )

    values = struct.unpack(f"<{count * dim}f", payload)
    inflated = []

    for cel in celebrities:
        entry = index.get(cel["id"])
        if entry is None:
            raise KeyError(f"Missing embedding index for {cel['id']}")

        start = entry["index"] * dim
        end = start + dim
        embedding = values[start:end]
        if len(embedding) != dim:
            raise ValueError(f"Embedding slice for {cel['id']} is incomplete")

        inflated.append({
            **cel,
            "embedding": list(embedding),
        })

    return inflated


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
        help=(
            "Skip face processing; regenerate public JSON and embedding files from "
            "existing celebrities.json plus embeddings.bin/index"
        ),
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    celebrities_json = output_dir / PUBLIC_CELEBRITIES_JSON
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

    loaded_celebrities = load_json(celebrities_json)

    if has_embeddings(loaded_celebrities):
        celebrities = loaded_celebrities
        source_label = str(celebrities_json)
    elif args.skip_processing:
        embeddings_bin = output_dir / "embeddings.bin"
        embeddings_index = output_dir / "embeddings_index.json"
        if not embeddings_bin.is_file() or not embeddings_index.is_file():
            print(
                "Error: skip-processing requires existing embeddings.bin and "
                "embeddings_index.json when celebrities.json has no embeddings.",
                file=sys.stderr,
            )
            sys.exit(1)
        celebrities = inflate_embeddings(
            loaded_celebrities,
            embeddings_bin,
            embeddings_index,
        )
        source_label = f"{celebrities_json} + {embeddings_bin} + {embeddings_index}"
    else:
        print(
            f"Error: {celebrities_json} does not contain embeddings after processing.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"\nLoaded {len(celebrities)} celebrities from {source_label}")

    embeddings_bin = output_dir / "embeddings.bin"
    write_binary_embeddings(celebrities, embeddings_bin)

    embeddings_index = output_dir / "embeddings_index.json"
    write_embedding_index(celebrities, embeddings_index)

    # ---------------------------------------------------------------
    # Step 3: Write a slim version without embeddings for fast loading
    # ---------------------------------------------------------------
    public_celebrities = strip_embeddings(celebrities)

    with open(celebrities_json, "w", encoding="utf-8") as f:
        json.dump(public_celebrities, f, ensure_ascii=False, indent=2)
    print(f"Public JSON (no embeddings) written: {celebrities_json}")

    slim_path = output_dir / "celebrities_slim.json"
    with open(slim_path, "w", encoding="utf-8") as f:
        json.dump(public_celebrities, f, ensure_ascii=False, indent=2)
    print(f"Slim JSON (no embeddings) written: {slim_path}")

    print("\nAll done.")


if __name__ == "__main__":
    main()
