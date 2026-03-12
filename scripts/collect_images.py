"""Collect celebrity face images from Wikimedia Commons (free license)."""

import json
import os
import sys
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

# (name, category, search_query for Wikimedia Commons)
CELEBRITIES = [
    # 俳優
    ("佐藤健", "actor", "Satoh Takeru actor Tokyo"),
    ("竹内涼真", "actor", "Takeuchi Ryoma actor"),
    ("山崎賢人", "actor", "Yamazaki Kento actor"),
    ("新田真剣佑", "actor", "Mackenyu Arata actor"),
    ("吉沢亮", "actor", "Yoshizawa Ryo actor"),
    ("福士蒼汰", "actor", "Fukushi Sota actor"),
    ("菅田将暉", "actor", "Suda Masaki actor"),
    ("横浜流星", "actor", "Yokohama Ryusei actor"),
    ("中村倫也", "actor", "Nakamura Tomoya actor Tokyo"),
    ("岡田准一", "actor", "Okada Junichi actor"),
    # 女優
    ("新垣結衣", "actress", "Aragaki Yui"),
    ("石原さとみ", "actress", "Ishihara Satomi actress"),
    ("広瀬すず", "actress", "Hirose Suzu"),
    ("浜辺美波", "actress", "Hamabe Minami actress"),
    ("橋本環奈", "actress", "Hashimoto Kanna actress"),
    ("今田美桜", "actress", "Imada Mio actress"),
    ("長澤まさみ", "actress", "Nagasawa Masami actress"),
    ("北川景子", "actress", "Kitagawa Keiko actress"),
    ("綾瀬はるか", "actress", "Ayase Haruka actress"),
    ("有村架純", "actress", "Arimura Kasumi actress"),
]


def search_commons(query: str) -> list[dict]:
    """Search Wikimedia Commons for images."""
    params = {
        "action": "query",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrsearch": query,
        "gsrlimit": "5",
        "prop": "imageinfo",
        "iiprop": "url|mime",
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
                if "imageinfo" in page:
                    info = page["imageinfo"][0]
                    mime = info.get("mime", "")
                    if mime.startswith("image/"):
                        results.append({
                            "title": page["title"],
                            "url": info.get("thumburl") or info.get("url"),
                        })
            return results
    except Exception as e:
        print(f"  Search error: {e}")
        return []


def download_image(url: str, path: str) -> bool:
    """Download image from URL."""
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
