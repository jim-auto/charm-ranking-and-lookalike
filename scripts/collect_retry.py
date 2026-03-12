"""Retry collecting images with alternative search queries."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

# Deleted bad images - retry with better queries
CELEBRITIES = [
    ("池田エライザ", "actress", "Ikeda Elaiza actress model"),
    ("ラウール", "idol", "Raul Snow Man Johnny"),
    ("YUKI", "artist", "YUKI singer Judy Mary Japanese"),
    ("フワちゃん", "influencer", "Fuwachan comedian talent Japan"),
    ("東海オンエア てつや", "influencer", "Tokai OnAir YouTuber Tetsuya comedian"),
    ("幾田りら", "artist", "Ikuta Lilas YOASOBI singer"),
    ("あいみょん", "artist", "Aimyon Japanese singer songwriter"),
    ("優里", "artist", "Yuuri Japanese singer Dry Flower"),
    ("Aimer", "artist", "Aimer Japanese singer anisong"),
    ("Ado", "artist", "Ado Japanese singer Usseewa"),
    ("佐々木舞香", "idol", "Sasaki Maika equal love idol singer"),
    # Also retry rate-limited ones
    ("星野源", "artist", "Gen Hoshino singer actor"),
    ("渡辺直美", "influencer", "Naomi Watanabe comedian actress"),
    ("朝倉未来", "influencer", "Asakura Mikuru fighter RIZIN"),
    ("朝倉海", "influencer", "Asakura Kai fighter UFC"),
    ("松井珠理奈", "idol", "Matsui Jurina SKE48"),
    ("小栗旬", "actor", "Oguri Shun actor"),
    ("藤原竜也", "actor", "Fujiwara Tatsuya actor Battle Royale"),
    ("岡田将生", "actor", "Okada Masaki actor Japan"),
]

def search_commons(query):
    params = {
        "action": "query", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": query, "gsrlimit": "10", "prop": "imageinfo",
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
        time.sleep(4)  # longer delay to avoid 429
    print(f"\nDone: {success}/{len(CELEBRITIES)} images collected")

if __name__ == "__main__":
    main()
