#!/usr/bin/env python3
"""Filter public site data to the currently visible subset."""

from __future__ import annotations

import json
import struct
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "web" / "public" / "data"
MAX_PUBLIC_AGE = 39
EMBEDDING_DIM = 128


def is_visible(entry: dict) -> bool:
    age = entry.get("age")
    return isinstance(age, int) and age <= MAX_PUBLIC_AGE


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_embeddings(bin_path: Path, index_path: Path) -> tuple[bytes, dict[str, dict]]:
    index = load_json(index_path)
    with open(bin_path, "rb") as f:
        header = f.read(8)
        count, dim = struct.unpack("<II", header)
        payload = f.read()

    if dim != EMBEDDING_DIM:
        raise ValueError(f"Unexpected embedding dimension: {dim}")
    expected = count * dim * 4
    if len(payload) != expected:
        raise ValueError(f"Unexpected embedding payload size: {len(payload)} != {expected}")

    return payload, index


def main() -> None:
    celebrities_path = DATA_DIR / "celebrities.json"
    slim_path = DATA_DIR / "celebrities_slim.json"
    embeddings_bin_path = DATA_DIR / "embeddings.bin"
    embeddings_index_path = DATA_DIR / "embeddings_index.json"

    celebrities = load_json(celebrities_path)
    visible = [entry for entry in celebrities if is_visible(entry)]

    payload, index = load_embeddings(embeddings_bin_path, embeddings_index_path)
    filtered_embeddings = bytearray()
    filtered_index: dict[str, dict] = {}

    for new_idx, entry in enumerate(visible):
        src = index.get(entry["id"])
        if src is None:
            raise KeyError(f"Missing embedding index for {entry['id']}")
        start = src["index"] * EMBEDDING_DIM * 4
        end = start + EMBEDDING_DIM * 4
        filtered_embeddings.extend(payload[start:end])
        filtered_index[entry["id"]] = {
            "index": new_idx,
            "name": entry["name"],
        }

    with open(celebrities_path, "w", encoding="utf-8") as f:
        json.dump(visible, f, ensure_ascii=False, indent=2)
    with open(slim_path, "w", encoding="utf-8") as f:
        json.dump(visible, f, ensure_ascii=False, indent=2)

    with open(embeddings_bin_path, "wb") as f:
        f.write(struct.pack("<II", len(visible), EMBEDDING_DIM))
        f.write(filtered_embeddings)
    with open(embeddings_index_path, "w", encoding="utf-8") as f:
        json.dump(filtered_index, f, ensure_ascii=False, indent=2)

    print(
        f"Filtered public data: total={len(celebrities)} visible={len(visible)} "
        f"hidden={len(celebrities) - len(visible)} max_age={MAX_PUBLIC_AGE}"
    )


if __name__ == "__main__":
    main()
