#!/usr/bin/env python3
"""Download requested athlete/sumo/comedian photos from Wikimedia Commons."""

import json
import os
import sys
import time
import urllib.parse
import urllib.request


sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

CELEBRITIES = [
    # Sumo
    {"name": "把瑠都", "dir_name": "把瑠都凱斗", "category": "sumo", "query": "Baruto Kaito sumo wrestler"},
    {"name": "琴欧洲", "dir_name": "琴欧洲勝紀", "category": "sumo", "query": "Kotooshu Katsunori sumo wrestler"},
    {"name": "魁皇", "dir_name": "魁皇博之", "category": "sumo", "query": "Kaio Hiroyuki sumo wrestler"},
    {"name": "千代大海", "dir_name": "千代大海龍二", "category": "sumo", "query": "Chiyotaikai Ryuji sumo wrestler"},
    {"name": "若乃花", "dir_name": "若乃花勝", "category": "sumo", "query": "Wakanohana Masaru sumo wrestler"},
    {"name": "曙", "dir_name": "曙太郎", "category": "sumo", "query": "Akebono Taro sumo wrestler"},
    {"name": "武蔵丸", "dir_name": "武蔵丸光洋", "category": "sumo", "query": "Musashimaru sumo wrestler"},
    {"name": "旭天鵬", "dir_name": "旭天鵬勝", "category": "sumo", "query": "Kyokutenho Masaru sumo wrestler"},
    {"name": "安美錦", "dir_name": "安美錦竜児", "category": "sumo", "query": "Aminishiki Ryuji sumo wrestler"},
    {"name": "豪栄道", "dir_name": "豪栄道豪太郎", "category": "sumo", "query": "Goeido Gotaro sumo wrestler"},
    {"name": "栃煌山", "dir_name": "栃煌山雄一郎", "category": "sumo", "query": "Tochiozan Yuichiro sumo wrestler"},
    {"name": "妙義龍", "dir_name": "妙義龍泰成", "category": "sumo", "query": "Myogiryu Yasunari sumo wrestler"},
    {"name": "碧山", "dir_name": "碧山亘右", "category": "sumo", "query": "Aoiyama Kosuke sumo wrestler"},
    {"name": "宝富士", "dir_name": "宝富士大輔", "category": "sumo", "query": "Takarafuji Daisuke sumo wrestler"},
    {"name": "千代の国", "dir_name": "千代の国憲輝", "category": "sumo", "query": "Chiyonokuni Toshiki sumo wrestler"},
    {"name": "炎鵬", "dir_name": "炎鵬晃", "category": "sumo", "query": "Enho Akira sumo wrestler"},
    {"name": "宇良", "dir_name": "宇良和輝", "category": "sumo", "query": "Ura Kazuki sumo wrestler"},
    # Soccer
    {"name": "中村俊輔", "dir_name": "中村俊輔", "category": "athlete", "query": "Shunsuke Nakamura footballer"},
    {"name": "遠藤保仁", "dir_name": "遠藤保仁", "category": "athlete", "query": "Yasuhito Endo footballer"},
    {"name": "長谷部誠", "dir_name": "長谷部誠", "category": "athlete", "query": "Makoto Hasebe footballer"},
    {"name": "岡崎慎司", "dir_name": "岡崎慎司", "category": "athlete", "query": "Shinji Okazaki footballer"},
    {"name": "酒井宏樹", "dir_name": "酒井宏樹", "category": "athlete", "query": "Hiroki Sakai footballer"},
    {"name": "柴崎岳", "dir_name": "柴崎岳", "category": "athlete", "query": "Gaku Shibasaki footballer"},
    {"name": "浅野拓磨", "dir_name": "浅野拓磨", "category": "athlete", "query": "Takuma Asano footballer"},
    # Baseball
    {"name": "王貞治", "dir_name": "王貞治", "category": "athlete", "query": "Sadaharu Oh baseball"},
    {"name": "長嶋茂雄", "dir_name": "長嶋茂雄", "category": "athlete", "query": "Shigeo Nagashima baseball"},
    {"name": "野茂英雄", "dir_name": "野茂英雄", "category": "athlete", "query": "Hideo Nomo baseball pitcher"},
    {"name": "松坂大輔", "dir_name": "松坂大輔", "category": "athlete", "query": "Daisuke Matsuzaka baseball pitcher"},
    {"name": "斎藤佑樹", "dir_name": "斎藤佑樹", "category": "athlete", "query": "Yuki Saito baseball pitcher Nippon-Ham"},
    {"name": "坂本勇人", "dir_name": "坂本勇人", "category": "athlete", "query": "Hayato Sakamoto baseball"},
    {"name": "村上宗隆", "dir_name": "村上宗隆", "category": "athlete", "query": "Munetaka Murakami baseball"},
    {"name": "吉田正尚", "dir_name": "吉田正尚", "category": "athlete", "query": "Masataka Yoshida baseball"},
    {"name": "栗山英樹", "dir_name": "栗山英樹", "category": "athlete", "query": "Hideki Kuriyama baseball manager"},
    # Judo
    {"name": "野村忠宏", "dir_name": "野村忠宏", "category": "athlete", "query": "Tadahiro Nomura judo"},
    {"name": "谷亮子", "dir_name": "谷亮子", "category": "athlete", "query": "Tamura Ryoko judoka"},
    {"name": "井上康生", "dir_name": "井上康生", "category": "athlete", "query": "Kosei Inoue judo"},
    {"name": "阿部一二三", "dir_name": "阿部一二三", "category": "athlete", "query": "Hifumi Abe judo"},
    {"name": "大野将平", "dir_name": "大野将平", "category": "athlete", "query": "Shohei Ono judo"},
    # Other
    {"name": "桐生祥秀", "dir_name": "桐生祥秀", "category": "athlete", "query": "Yoshihide Kiryu sprinter"},
    {"name": "山縣亮太", "dir_name": "山縣亮太", "category": "athlete", "query": "Ryota Yamagata sprinter"},
    {"name": "萩野公介", "dir_name": "萩野公介", "category": "athlete", "query": "Kosuke Hagino swimmer"},
    {"name": "宮川大輔", "dir_name": "宮川大輔", "category": "comedian", "query": "Daisuke Miyagawa comedian"},
    {"name": "千原ジュニア", "dir_name": "千原ジュニア", "category": "comedian", "query": "Chihara Junior comedian"},
]


def search_commons(query):
    params = {
        "action": "query",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrsearch": query,
        "gsrlimit": "20",
        "prop": "imageinfo",
        "iiprop": "url|mime|size",
        "iiurlwidth": "800",
        "format": "json",
    }
    url = f"https://commons.wikimedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if "query" not in data:
                return []
            results = []
            for page in data["query"]["pages"].values():
                if "imageinfo" not in page:
                    continue
                info = page["imageinfo"][0]
                mime = info.get("mime", "")
                width = info.get("width", 0)
                height = info.get("height", 0)
                if mime.startswith("image/") and "svg" not in mime and info.get("size", 0) >= 10000:
                    results.append(
                        {
                            "title": page["title"],
                            "url": info.get("thumburl") or info.get("url"),
                            "width": width,
                            "height": height,
                            "size": info.get("size", 0),
                        }
                    )
            results.sort(
                key=lambda r: (1 if r["height"] > r["width"] * 0.8 else 0, r["size"]),
                reverse=True,
            )
            return results
    except Exception as exc:
        print(f"  Search error: {exc}")
        return []


def download_image(url, path):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            with open(path, "wb") as f:
                f.write(resp.read())
        return True
    except Exception as exc:
        print(f"  DL error: {exc}")
        return False


def write_category(cat_path, category):
    with open(cat_path, "w", encoding="utf-8") as f:
        f.write(category)


def main():
    downloaded_count = 0
    skipped = []
    failed = []

    for index, celeb in enumerate(CELEBRITIES, start=1):
        name = celeb["name"]
        dir_name = celeb["dir_name"]
        category = celeb["category"]
        query = celeb["query"]

        person_dir = os.path.join(OUTPUT_DIR, dir_name)
        os.makedirs(person_dir, exist_ok=True)

        img_path = os.path.join(person_dir, "photo.jpg")
        cat_path = os.path.join(person_dir, "category.txt")
        write_category(cat_path, category)

        if os.path.exists(img_path) and os.path.getsize(img_path) > 10000:
            print(
                f"[{index}/{len(CELEBRITIES)}] {name} - SKIP "
                f"(already have photo in {dir_name})"
            )
            skipped.append(name)
            continue

        print(f"[{index}/{len(CELEBRITIES)}] {name} ({query}) ...", flush=True)
        results = search_commons(query)
        if not results:
            print("  NO RESULTS")
            failed.append(name)
            time.sleep(3)
            continue

        for result_index, result in enumerate(results[:5]):
            print(
                f"  {result_index}: {result['width']}x{result['height']} "
                f"{result['size'] // 1024}KB {result['title']}"
            )

        downloaded = False
        for result in results:
            if download_image(result["url"], img_path):
                size_kb = os.path.getsize(img_path) // 1024
                print(f"  -> Downloaded {size_kb}KB - {result['title']}")
                downloaded = True
                downloaded_count += 1
                break

        if not downloaded:
            print("  FAILED")
            failed.append(name)

        time.sleep(3)

    print(
        f"\nDone: {downloaded_count} downloaded, "
        f"{len(skipped)} skipped, {len(failed)} failed"
    )
    if failed:
        print(f"Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
