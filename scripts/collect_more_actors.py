"""Collect more actors/actresses from Wikimedia Commons."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

CELEBRITIES = [
    # 俳優追加
    ("窪田正孝", "actor", "Masataka Kubota actor"),
    ("岡田将生", "actor", "Masaki Okada actor Japan"),
    ("三浦春馬", "actor", "Haruma Miura actor"),
    ("鬼頭明里", "actress", "Akari Kito voice actress"),
    ("福山雅治", "actor", "Masaharu Fukuyama actor singer"),
    ("木村拓哉", "actor", "Takuya Kimura actor SMAP"),
    ("妻夫木聡", "actor", "Satoshi Tsumabuki actor"),
    ("小栗旬", "actor", "Shun Oguri actor Japan"),
    ("藤原竜也", "actor", "Tatsuya Fujiwara actor"),
    ("長瀬智也", "actor", "Tomoya Nagase TOKIO actor"),
    # 女優追加
    ("石田ゆり子", "actress", "Yuriko Ishida actress Japan"),
    ("天海祐希", "actress", "Yuki Amami actress Takarazuka"),
    ("仲間由紀恵", "actress", "Yukie Nakama actress Japan"),
    ("宮崎あおい", "actress", "Aoi Miyazaki actress"),
    ("蒼井優", "actress", "Yu Aoi actress Japan"),
    ("多部未華子", "actress", "Mikako Tabe actress"),
    ("戸田恵梨香", "actress", "Erika Toda actress"),
    ("満島ひかり", "actress", "Hikari Mitsushima actress"),
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
            if "query" not in data: return []
            results = []
            for page in data["query"]["pages"].values():
                if "imageinfo" in page:
                    info = page["imageinfo"][0]
                    mime = info.get("mime", "")
                    if mime.startswith("image/") and "svg" not in mime:
                        results.append({"title": page["title"], "url": info.get("thumburl") or info.get("url")})
            return results
    except Exception as e:
        print(f"  Search error: {e}")
        return []

def download_image(url, path):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            with open(path, "wb") as f: f.write(resp.read())
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
        if not downloaded: print("FAILED")
        else: success += 1
        time.sleep(3)
    print(f"\nDone: {success}/{len(CELEBRITIES)} images collected")

if __name__ == "__main__":
    main()
