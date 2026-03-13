"""Replace non-frontal photos with better ones from Wikimedia Commons."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

# People who were skipped due to non-frontal photos
CELEBRITIES = [
    ("菅田将暉", "actor", "Masaki Suda actor"),
    ("間宮祥太朗", "actor", "Mamiya Shotaro actor"),
    ("石原さとみ", "actress", "Satomi Ishihara actress"),
    ("西野七瀬", "idol", "Nishino Nanase Nogizaka46"),
    ("大谷映美里", "idol", "Otani Emiri equal love idol"),
    ("山下美月", "idol", "Yamashita Mizuki Nogizaka46"),
    ("玉木宏", "actor", "Tamaki Hiroshi actor"),
    ("高畑充希", "actress", "Takahata Mitsuki actress"),
    ("三浦春馬", "actor", "Haruma Miura actor"),
    ("生田絵梨花", "idol", "Ikuta Erika Nogizaka46"),
    ("磯村勇斗", "actor", "Isomura Hayato actor"),
    ("戸田恵梨香", "actress", "Erika Toda actress"),
]

def search_commons(query):
    params = {
        "action": "query", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": query, "gsrlimit": "15", "prop": "imageinfo",
        "iiprop": "url|mime|size", "iiurlwidth": "800", "format": "json",
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
                    w = info.get("width", 0)
                    h = info.get("height", 0)
                    if mime.startswith("image/") and "svg" not in mime:
                        results.append({
                            "title": page["title"],
                            "url": info.get("thumburl") or info.get("url"),
                            "width": w, "height": h,
                            "size": info.get("size", 0),
                        })
            # Prefer portrait-ish images (height > width) and larger files
            results.sort(key=lambda r: (
                1 if r["height"] > r["width"] * 0.8 else 0,
                r["size"]
            ), reverse=True)
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
        img_path = os.path.join(person_dir, "photo.jpg")
        # Always re-download (replacing non-frontal)
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
                print(f"OK ({size}KB) - {result['title']} ({result['width']}x{result['height']})")
                downloaded = True
                break
        if not downloaded: print("FAILED")
        else: success += 1
        time.sleep(4)
    print(f"\nDone: {success}/{len(CELEBRITIES)} images collected")

if __name__ == "__main__":
    main()
