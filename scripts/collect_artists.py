"""Collect artists + retry idol groups with different search queries."""

import json
import os
import sys
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

CELEBRITIES = [
    # ===== アーティスト =====
    ("幾田りら", "artist", "Ikura YOASOBI singer"),
    ("あいみょん", "artist", "Aimyon singer"),
    ("大森元貴", "artist", "Omori Motoki Mrs GREEN APPLE"),
    ("優里", "artist", "Yuuri singer Japan"),
    ("Ado", "artist", "Ado singer Japan"),
    ("米津玄師", "artist", "Kenshi Yonezu musician"),
    ("藤井風", "artist", "Fujii Kaze musician"),
    ("LISA", "artist", "LiSA singer anime"),
    ("Aimer", "artist", "Aimer singer Japan"),
    ("Official髭男dism藤原聡", "artist", "Fujiwara Satoshi Official HIGE DANdism"),
    ("King Gnu井口理", "artist", "Iguchi Satoru King Gnu"),
    ("back number清水依与吏", "artist", "Shimizu Iyori back number"),

    # ===== イコラブ (=LOVE) 別クエリで再試行 =====
    ("齊藤なぎさ", "idol", "Saito Nagisa idol singer"),
    ("野口衣織", "idol", "Noguchi Iori idol singer"),
    ("佐々木舞香", "idol", "Sasaki Maika idol"),
    ("髙松瞳", "idol", "Takamatsu Hitomi idol"),
    ("音嶋莉沙", "idol", "Otoshima Risa equal love"),
    ("瀧脇笙古", "idol", "Takiwaki Shoko equal love"),

    # ===== ノイミー (≠ME) =====
    ("冨田菜々風", "idol", "Tomita Nanaho idol"),
    ("蟹沢萌子", "idol", "Kanizawa Moeko idol"),
    ("鈴木瞳美", "idol", "Suzuki Hitomi idol"),
    ("櫻井もも", "idol", "Sakurai Momo idol singer"),
    ("谷崎早耶", "idol", "Tanizaki Saya idol"),

    # ===== 俳優・女優リトライ =====
    ("本田翼", "actress", "Honda Tsubasa model actress Japan"),
    ("森七菜", "actress", "Nana Mori actress"),
    ("北村匠海", "actor", "Kitamura Takumi DISH actor"),
    ("高橋文哉", "actor", "Takahashi Fumiya actor Japan"),
    ("平野紫耀", "idol", "Hirano Sho idol Japan"),
    ("髙橋海人", "idol", "Takahashi Kaito idol Japan"),
    ("永瀬廉", "idol", "Nagase Ren idol Japan"),
    ("岸優太", "idol", "Kishi Yuta idol Japan"),
    ("小坂菜緒", "idol", "Kosaka Nao Hinatazaka"),
    ("田中美久", "idol", "Tanaka Miku HKT48 idol"),
]


def search_commons(query):
    params = {
        "action": "query", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": query, "gsrlimit": "8", "prop": "imageinfo",
        "iiprop": "url|mime", "iiurlwidth": "800", "format": "json",
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
                if "imageinfo" in page:
                    info = page["imageinfo"][0]
                    mime = info.get("mime", "")
                    if mime.startswith("image/") and "svg" not in mime:
                        results.append({
                            "title": page["title"],
                            "url": info.get("thumburl") or info.get("url"),
                        })
            return results
    except Exception as e:
        print(f"  Search error: {e}")
        return []


def download_image(url, path):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            with open(path, "wb") as f:
                f.write(resp.read())
        return True
    except Exception as e:
        print(f"  DL error: {e}")
        return False


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    success = 0

    for i, (name, category, query) in enumerate(CELEBRITIES):
        person_dir = os.path.join(OUTPUT_DIR, name)
        os.makedirs(person_dir, exist_ok=True)

        with open(os.path.join(person_dir, "category.txt"), "w", encoding="utf-8") as f:
            f.write(category)

        img_path = os.path.join(person_dir, "photo.jpg")
        if os.path.exists(img_path) and os.path.getsize(img_path) > 1000:
            print(f"[skip] {name}")
            success += 1
            continue

        print(f"[{i+1}/{len(CELEBRITIES)}] {name} ({query}) ...", end=" ", flush=True)
        results = search_commons(query)
        if not results:
            print("NO RESULTS")
            time.sleep(2)
            continue

        downloaded = False
        for result in results:
            if download_image(result["url"], img_path):
                size = os.path.getsize(img_path) // 1024
                print(f"OK ({size}KB) - {result['title']}")
                downloaded = True
                break

        if not downloaded:
            print("FAILED")
        else:
            success += 1

        time.sleep(3)

    print(f"\nDone: {success}/{len(CELEBRITIES)} images collected")


if __name__ == "__main__":
    main()
