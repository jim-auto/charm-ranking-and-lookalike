"""Collect more influencers from Wikimedia Commons."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

CELEBRITIES = [
    # インフルエンサー (現在7人 → 10人以上に)
    ("渡辺直美", "influencer", "Naomi Watanabe comedian entertainer"),
    ("フワちゃん", "influencer", "Fuwachan YouTuber Japan"),
    ("コムドット やまと", "influencer", "Comudotto Yamato YouTuber"),
    ("東海オンエア てつや", "influencer", "Tokai On Air Tetsuya YouTuber"),
    ("水溜りボンド カンタ", "influencer", "Mizutamari Bond Kanta YouTuber"),
    ("ヒカル", "influencer", "Hikaru YouTuber Japan"),
    ("朝倉未来", "influencer", "Mikuru Asakura MMA fighter"),
    ("朝倉海", "influencer", "Kai Asakura MMA fighter"),
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
