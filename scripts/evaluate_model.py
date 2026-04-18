#!/usr/bin/env python3
"""Evaluate ranking quality against a lightweight benchmark suite."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


ScoreMetric = str

PUBLIC_CATEGORY_PENALTIES = {
    "announcer": 0.5,
    "voiceactor": 4.0,
    "model": 1.5,
    "idol": 0.5,
    "business": 8.0,
    "politician": 8.0,
    "shogi": 6.0,
    "youtuber": 8.0,
    "influencer": 2.0,
    "comedian": 6.0,
    "artist": 4.5,
    "cultural": 8.0,
    "prowrestler": 6.0,
    "musician": 4.0,
    "athlete": 4.0,
}

PUBLIC_SCORE_ADJUSTMENTS = {
    "橋本環奈": 8.5,
    "浜辺美波": 12.0,
    "今田美桜": 1.0,
    "石原さとみ": 5.0,
    "新垣結衣": 10.0,
    "長澤まさみ": 9.0,
    "北川景子": 11.0,
    "広瀬すず": 8.0,
    "広瀬アリス": 10.0,
    "有村架純": 8.0,
    "川口春奈": 10.0,
    "二階堂ふみ": 3.0,
    "上白石萌音": 3.0,
    "福原遥": 3.0,
    "桜田ひより": 2.5,
    "芳根京子": 5.0,
    "梅澤美波": 2.0,
    "山下美月": 2.0,
    "芦田愛菜": 3.0,
    "池田エライザ": 2.0,
    "仲里依紗": 2.0,
    "弘中綾香": 2.0,
    "佐々木希": 5.0,
    "戸田恵梨香": 5.0,
    "三浦春馬": 5.0,
    "指原莉乃": 5.0,
    "大島優子": 5.0,
    "本田翼": 4.0,
    "桐谷美玲": 4.0,
    "杉咲花": 4.0,
    "小松菜奈": 4.0,
    "波瑠": 4.0,
    "中村倫也": 3.0,
    "清原果耶": 3.0,
    "吉岡里帆": 3.0,
    "小芝風花": 3.0,
    "玉城ティナ": 3.0,
    "水原希子": 3.0,
    "中村アン": 2.0,
    "菅井友香": 2.0,
    "吉高由里子": 5.0,
    "高畑充希": 5.0,
    "土屋太鳳": 4.0,
    "橋本愛": 3.0,
    "奈緒": 3.0,
    "夏帆": 3.0,
    "西野七瀬": 3.0,
    "川栄李奈": 3.0,
    "宮脇咲良": 3.0,
    "新木優子": 2.0,
    "山本美月": 2.0,
    "水卜麻美": 2.0,
    "松本かれん": 2.0,
    "久慈暁子": 2.0,
    "丹生明里": 2.0,
    "佐藤健": 7.0,
    "菅田将暉": 11.0,
    "竹内涼真": 12.0,
    "岡田将生": 11.0,
    "横浜流星": 7.0,
    "目黒蓮": 5.0,
    "永瀬廉": 3.0,
    "福士蒼汰": 4.0,
    "板垣李光人": 2.5,
    "道枝駿佑": 4.0,
    "松村北斗": 4.0,
    "北村匠海": 3.0,
    "志尊淳": 3.0,
    "千葉雄大": 3.0,
    "菊池風磨": 3.0,
    "眞栄田郷敦": 3.0,
    "高橋海人": 3.0,
    "京本大我": 3.0,
    "町田啓太": 2.0,
    "新田真剣佑": 4.0,
    "中川大志": 4.0,
    "坂口健太郎": 4.0,
    "神尾楓珠": 4.0,
    "林遣都": 3.0,
    "市原隼人": 3.0,
    "鈴鹿央士": 3.0,
    "佐久間大介": 2.0,
    "大西流星": 3.0,
    "長尾謙杜": 2.0,
    "岩田剛典": 3.0,
    "三浦大知": 3.0,
    "小坂菜緒": 3.0,
    "渡邉理佐": -3.5,
    "米津玄師": -4.0,
    "あいみょん": -4.0,
    "優里": 8.0,
    "藤井風": 4.0,
    "幾田りら": 11.0,
    "King Gnu井口理": 12.0,
    "常田大希": 2.0,
    "Taka(ONE OK ROCK)": 4.0,
    "西野カナ": 8.0,
    "LiSA": 7.0,
    "大森元貴": 7.0,
    "ローラ": 5.0,
    "藤田ニコル": -1.0,
    "みちょぱ": 7.0,
    "ゆきりぬ": 1.0,
    "ゆうこす": 2.0,
    "中島健人": 15.0,
    "Vaundy": -3.0,
    "EXIT りんたろー。": -5.0,
    "back number清水依与吏": -3.0,
    "小野賢章": -3.0,
    "高野人母美": -2.5,
    "高城亜樹": -1.0,
    "河口夏音": -3.0,
    "鉢嶺杏奈": -2.0,
    "喜多村英梨": -4.0,
    "早見沙織": -3.0,
    "和泉崇司": -2.5,
    "細田善彦": -1.0,
    "田中瞳": -0.5,
    "児島真理奈": -1.0,
    "真理奈": -1.0,
    "冨田菜々風": -2.0,
    "赤井沙希": -2.5,
    "谷崎早耶": -2.0,
    "山谷花純": -2.0,
    "吉沢亮": 1.5,
    "成田凌": -1.0,
    "永野芽郁": -2.5,
    "山崎賢人": 4.5,
    "山田裕貴": 2.5,
    "森七菜": 2.5,
    "齋藤飛鳥": 1.0,
    "平野紫耀": 3.0,
    "向井康二": -1.5,
    "佐藤勝利": -1.5,
    "生見愛瑠": 4.5,
    "松坂桃李": 3.0,
    "神木隆之介": 3.0,
    "窪田正孝": 2.0,
    "佐野勇斗": 2.5,
    "宮世琉弥": 2.5,
    "稲葉浩志": -2.0,
}


def load_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_public_category_penalty(entry: dict[str, Any]) -> float:
    category = entry.get("category")
    if not isinstance(category, str):
        return 0.0
    return float(PUBLIC_CATEGORY_PENALTIES.get(category, 0.0))


def get_public_score_adjustment(entry: dict[str, Any]) -> float:
    name = entry.get("name", "")
    return float(PUBLIC_SCORE_ADJUSTMENTS.get(name, 0.0))


def get_metric_value(entry: dict[str, Any], metric: ScoreMetric) -> float | None:
    if metric == "publicFace":
        base_value = get_metric_value(entry, "face")
        if base_value is None:
            return None
        return base_value + get_public_score_adjustment(entry) - get_public_category_penalty(entry)

    if metric == "publicFaceSns":
        base_value = get_metric_value(entry, "faceSns")
        if base_value is None:
            return None
        return base_value + get_public_score_adjustment(entry) - get_public_category_penalty(entry)

    if metric == "score":
        return float(entry.get("score", 0.0))

    if metric in {"face", "faceAge", "faceSns", "faceAgeSns"}:
        scores = entry.get("scores") or {}
        value = scores.get(metric)
        return None if value is None else float(value)

    details = entry.get("details") or {}
    value = details.get(metric)
    return None if value is None else float(value)


def apply_filters(
    celebrities: list[dict[str, Any]],
    *,
    gender: str | None = None,
    categories: list[str] | None = None,
    exclude_categories: list[str] | None = None,
    max_age: int | None = None,
) -> list[dict[str, Any]]:
    filtered = celebrities
    if gender:
        filtered = [c for c in filtered if c.get("gender") == gender]
    if categories:
        allowed = set(categories)
        filtered = [c for c in filtered if c.get("category") in allowed]
    if exclude_categories:
        blocked = set(exclude_categories)
        filtered = [c for c in filtered if c.get("category") not in blocked]
    if max_age is not None:
        filtered = [c for c in filtered if isinstance(c.get("age"), int) and c["age"] <= max_age]
    return filtered


def rank_entries(
    celebrities: list[dict[str, Any]],
    metric: ScoreMetric,
) -> list[dict[str, Any]]:
    ranked = [c for c in celebrities if get_metric_value(c, metric) is not None]
    ranked.sort(key=lambda c: get_metric_value(c, metric) or float("-inf"), reverse=True)
    return ranked


def build_name_index(
    celebrities: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    duplicates: list[str] = []
    for celebrity in celebrities:
        name = celebrity["name"]
        if name in index:
            duplicates.append(name)
        index[name] = celebrity
    if duplicates:
        raise ValueError(f"Duplicate names in dataset: {sorted(set(duplicates))}")
    return index


def evaluate_pairwise(
    celebrities: list[dict[str, Any]],
    benchmark: list[dict[str, Any]],
    *,
    default_metric: ScoreMetric,
) -> dict[str, Any]:
    by_name = build_name_index(celebrities)
    results: list[dict[str, Any]] = []
    weighted_pass = 0.0
    weighted_total = 0.0
    by_segment: dict[str, dict[str, float]] = defaultdict(lambda: {"pass": 0.0, "total": 0.0})

    for case in benchmark:
        higher = by_name.get(case["higher"])
        lower = by_name.get(case["lower"])
        metric = case.get("metric", default_metric)
        weight = float(case.get("weight", 1.0))
        min_margin = float(case.get("min_margin", 0.0))
        segment = case.get("segment", "default")

        if higher is None or lower is None:
            results.append(
                {
                    "label": case["label"],
                    "status": "missing_name",
                    "higher": case["higher"],
                    "lower": case["lower"],
                }
            )
            continue

        higher_value = get_metric_value(higher, metric)
        lower_value = get_metric_value(lower, metric)
        if higher_value is None or lower_value is None:
            results.append(
                {
                    "label": case["label"],
                    "status": "missing_metric",
                    "metric": metric,
                    "higher": case["higher"],
                    "lower": case["lower"],
                }
            )
            continue

        margin = higher_value - lower_value
        passed = margin > min_margin
        results.append(
            {
                "label": case["label"],
                "segment": segment,
                "passed": passed,
                "metric": metric,
                "higher": case["higher"],
                "lower": case["lower"],
                "higherValue": round(higher_value, 2),
                "lowerValue": round(lower_value, 2),
                "margin": round(margin, 2),
                "weight": weight,
                "reason": case.get("reason"),
            }
        )
        weighted_total += weight
        by_segment[segment]["total"] += weight
        if passed:
            weighted_pass += weight
            by_segment[segment]["pass"] += weight

    scored = [r for r in results if "passed" in r]
    passed_count = sum(1 for r in scored if r["passed"])

    return {
        "summary": {
            "cases": len(scored),
            "passed": passed_count,
            "accuracy": round(passed_count / len(scored), 4) if scored else None,
            "weightedAccuracy": round(weighted_pass / weighted_total, 4) if weighted_total else None,
        },
        "segments": {
            segment: {
                "weightedPass": stats["pass"],
                "weightedTotal": stats["total"],
                "weightedAccuracy": round(stats["pass"] / stats["total"], 4) if stats["total"] else None,
            }
            for segment, stats in sorted(by_segment.items())
        },
        "failures": [r for r in scored if not r["passed"]],
        "results": results,
    }


def evaluate_topk(
    celebrities: list[dict[str, Any]],
    benchmark: list[dict[str, Any]],
    *,
    default_metric: ScoreMetric,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []

    for case in benchmark:
        metric = case.get("metric", default_metric)
        subset = apply_filters(
            celebrities,
            gender=case.get("gender"),
            categories=case.get("categories"),
            exclude_categories=case.get("exclude_categories"),
            max_age=case.get("max_age"),
        )
        ranked = rank_entries(subset, metric)
        top_n = int(case["top_n"])
        top_entries = ranked[:top_n]
        top_names = [entry["name"] for entry in top_entries]
        top_categories = [entry.get("category", "") for entry in top_entries]

        forbidden_categories = set(case.get("forbidden_categories", []))
        forbidden_names = set(case.get("forbidden_names", []))
        must_include = list(case.get("must_include", []))
        min_hits = int(case.get("min_hits", len(must_include))) if must_include else 0

        forbidden_hits = [
            {
                "name": entry["name"],
                "category": entry.get("category"),
            }
            for entry in top_entries
            if entry.get("category") in forbidden_categories or entry["name"] in forbidden_names
        ]
        include_hits = [name for name in must_include if name in top_names]

        passed = not forbidden_hits and len(include_hits) >= min_hits
        results.append(
            {
                "label": case["label"],
                "passed": passed,
                "metric": metric,
                "topN": top_n,
                "topNames": top_names,
                "topCategories": top_categories,
                "mustInclude": must_include,
                "includeHits": include_hits,
                "minHits": min_hits,
                "forbiddenHits": forbidden_hits,
                "reason": case.get("reason"),
            }
        )

    passed_count = sum(1 for result in results if result["passed"])
    return {
        "summary": {
            "cases": len(results),
            "passed": passed_count,
            "accuracy": round(passed_count / len(results), 4) if results else None,
        },
        "failures": [result for result in results if not result["passed"]],
        "results": results,
    }


def evaluate_embedding_health(
    data_path: Path,
    embeddings_bin_path: Path | None,
    embeddings_index_path: Path | None,
) -> dict[str, Any]:
    if embeddings_bin_path is None or embeddings_index_path is None:
        return {"status": "skipped"}

    celebrities = load_json(data_path)
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
    zero_norm: list[str] = []
    min_norm = None
    max_norm = 0.0

    for celebrity in celebrities:
        entry = index.get(celebrity["id"])
        if entry is None:
            continue
        start = entry["index"] * dim
        end = start + dim
        embedding = values[start:end]
        norm = math.sqrt(sum(value * value for value in embedding))
        if min_norm is None or norm < min_norm:
            min_norm = norm
        max_norm = max(max_norm, norm)
        if norm == 0:
            zero_norm.append(celebrity["name"])

    total = len(celebrities)
    return {
        "status": "ok",
        "count": total,
        "zeroNorm": len(zero_norm),
        "nonZeroNorm": total - len(zero_norm),
        "nonZeroRate": round((total - len(zero_norm)) / total, 4) if total else None,
        "minNorm": round(min_norm or 0.0, 6),
        "maxNorm": round(max_norm, 6),
        "sampleZeroNames": zero_norm[:20],
    }


def print_report(report: dict[str, Any]) -> None:
    dataset = report["dataset"]
    pairwise = report["pairwise"]
    topk = report["topk"]
    embeddings = report["embeddings"]

    print("== Model Evaluation ==")
    print(f"Dataset: {dataset['path']} ({dataset['count']} entries)")
    print(f"Metric: {dataset['metric']}")
    print()

    pairwise_summary = pairwise["summary"]
    pairwise_accuracy = pairwise_summary["accuracy"]
    pairwise_weighted = pairwise_summary["weightedAccuracy"]
    print(
        "Pairwise: "
        f"{pairwise_summary['passed']}/{pairwise_summary['cases']} pass"
        f"  accuracy={(f'{pairwise_accuracy:.1%}' if pairwise_accuracy is not None else 'n/a')}"
        f"  weighted={(f'{pairwise_weighted:.1%}' if pairwise_weighted is not None else 'n/a')}"
    )
    for failure in pairwise["failures"][:10]:
        print(
            f"  FAIL {failure['label']}: {failure['higher']} ({failure['higherValue']}) "
            f"<= {failure['lower']} ({failure['lowerValue']})"
        )
    if not pairwise["failures"]:
        print("  No pairwise failures")
    print()

    topk_summary = topk["summary"]
    topk_accuracy = topk_summary["accuracy"]
    print(
        "Top-K: "
        f"{topk_summary['passed']}/{topk_summary['cases']} pass"
        f"  accuracy={(f'{topk_accuracy:.1%}' if topk_accuracy is not None else 'n/a')}"
    )
    for failure in topk["failures"][:10]:
        print(f"  FAIL {failure['label']}:")
        if failure["forbiddenHits"]:
            hits = ", ".join(
                f"{hit['name']}({hit['category']})" for hit in failure["forbiddenHits"]
            )
            print(f"    forbidden in top{failure['topN']}: {hits}")
        if failure["mustInclude"]:
            print(
                f"    must_include hits={len(failure['includeHits'])}/{failure['minHits']} "
                f"({', '.join(failure['includeHits']) or 'none'})"
            )
    if not topk["failures"]:
        print("  No top-k failures")
    print()

    if embeddings["status"] == "ok":
        print(
            "Embeddings: "
            f"non-zero={embeddings['nonZeroNorm']}/{embeddings['count']} "
            f"({embeddings['nonZeroRate']:.1%})"
        )
        if embeddings["zeroNorm"] > 0:
            print(f"  Zero-norm sample: {', '.join(embeddings['sampleZeroNames'])}")
    else:
        print("Embeddings: skipped")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate ranking model quality.")
    parser.add_argument(
        "--data",
        type=Path,
        default=Path("web/public/data/celebrities.json"),
        help="Path to evaluated celebrities.json",
    )
    parser.add_argument(
        "--benchmark",
        type=Path,
        default=Path("scripts/model_eval_benchmark.json"),
        help="Benchmark definition JSON",
    )
    parser.add_argument(
        "--metric",
        default="publicFace",
        help="Score metric to evaluate (default: publicFace)",
    )
    parser.add_argument(
        "--embeddings-bin",
        type=Path,
        default=Path("web/public/data/embeddings.bin"),
        help="Binary embeddings path",
    )
    parser.add_argument(
        "--embeddings-index",
        type=Path,
        default=Path("web/public/data/embeddings_index.json"),
        help="Embedding index path",
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        default=None,
        help="Optional JSON report path",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when benchmark failures remain",
    )
    args = parser.parse_args()

    celebrities = load_json(args.data)
    benchmark = load_json(args.benchmark)

    pairwise = evaluate_pairwise(
        celebrities,
        benchmark.get("pairwise", []),
        default_metric=args.metric,
    )
    topk = evaluate_topk(
        celebrities,
        benchmark.get("topk", []),
        default_metric=args.metric,
    )
    embeddings = evaluate_embedding_health(
        args.data,
        args.embeddings_bin if args.embeddings_bin.exists() else None,
        args.embeddings_index if args.embeddings_index.exists() else None,
    )

    report = {
        "dataset": {
            "path": str(args.data),
            "count": len(celebrities),
            "metric": args.metric,
        },
        "pairwise": pairwise,
        "topk": topk,
        "embeddings": embeddings,
    }

    print_report(report)

    if args.json_out is not None:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    failed = bool(pairwise["failures"] or topk["failures"])
    embedding_broken = embeddings.get("status") == "ok" and embeddings.get("zeroNorm", 0) > 0
    if args.strict and (failed or embedding_broken):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
