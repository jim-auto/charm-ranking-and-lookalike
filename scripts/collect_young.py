"""Collect young celebrity images (10代20代) from Wikimedia Commons."""

import json
import os
import sys
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

CELEBRITIES = [
    # 女優・モデル (10代20代)
    ("芦田愛菜", "actress", "Ashida Mana actress"),
    ("森七菜", "actress", "Mori Nana actress"),
    ("清原果耶", "actress", "Kiyohara Kaya"),
    ("上白石萌歌", "actress", "Kamishiraishi Moka"),
    ("福原遥", "actress", "Fukuhara Haruka actress"),
    ("永野芽郁", "actress", "Nagano Mei actress"),
    ("南沙良", "actress", "Minami Sara actress"),
    # アイドル
    ("与田祐希", "idol", "Yoda Yuki Nogizaka46"),
    ("賀喜遥香", "idol", "Kaki Haruka Nogizaka46"),
    ("遠藤さくら", "idol", "Endo Sakura Nogizaka46"),
    ("目黒蓮", "idol", "Meguro Ren Snow Man"),
    ("道枝駿佑", "idol", "Michieda Shunsuke"),
    ("永瀬廉", "idol", "Nagase Ren King Prince"),
    # インフルエンサー
    ("藤田ニコル", "influencer", "Fujita Nicole model"),
    ("Koki", "influencer", "Koki Kimura model"),
    ("なえなの", "influencer", "Naenano"),
]


def search_commons(query):
    params = {
        "action": "query", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": query, "gsrlimit": "5", "prop": "imageinfo",
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
        print(f"  Download error: {e}")
        return False


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    success = 0

    for name, category, query in CELEBRITIES:
        person_dir = os.path.join(OUTPUT_DIR, name)
        os.makedirs(person_dir, exist_ok=True)

        with open(os.path.join(person_dir, "category.txt"), "w", encoding="utf-8") as f:
            f.write(category)

        img_path = os.path.join(person_dir, "photo.jpg")
        if os.path.exists(img_path):
            print(f"[skip] {name} - already exists")
            success += 1
            continue

        print(f"[search] {name} ({query}) ...", end=" ", flush=True)
        results = search_commons(query)
        if not results:
            print("NO RESULTS")
            continue

        downloaded = False
        for result in results:
            url = result["url"]
            if download_image(url, img_path):
                size = os.path.getsize(img_path) // 1024
                print(f"OK ({size}KB) - {result['title']}")
                downloaded = True
                break

        if not downloaded:
            print("FAILED")
        else:
            success += 1

        time.sleep(1.5)

    print(f"\nDone: {success}/{len(CELEBRITIES)} images collected")


if __name__ == "__main__":
    main()
