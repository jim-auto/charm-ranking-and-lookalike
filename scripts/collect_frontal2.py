"""Retry non-frontal photos with different queries."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

CELEBRITIES = [
    ("石原さとみ", "actress", "Ishihara Satomi face portrait"),
    ("西野七瀬", "idol", "Nishino Nanase face portrait actress"),
    ("山下美月", "idol", "Yamashita Mizuki Nogizaka46 portrait"),
    ("生田絵梨花", "idol", "Ikuta Erika musical actress portrait"),
    ("磯村勇斗", "actor", "Isomura Hayato face portrait actor"),
    ("間宮祥太朗", "actor", "Mamiya Shotaro face portrait"),
    ("戸田恵梨香", "actress", "Toda Erika face portrait actress"),
    ("高畑充希", "actress", "Takahata Mitsuki face portrait"),
    ("大谷映美里", "idol", "Otani Emiri ikorabu equal love"),
]

def search_commons(query):
    params = {
        "action": "query", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": query, "gsrlimit": "20", "prop": "imageinfo",
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
            # Sort: prefer portrait images, larger size
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
    success = 0
    for i, (name, category, query) in enumerate(CELEBRITIES):
        person_dir = os.path.join(OUTPUT_DIR, name)
        os.makedirs(person_dir, exist_ok=True)
        img_path = os.path.join(person_dir, "photo.jpg")
        print(f"[{i+1}/{len(CELEBRITIES)}] {name} ({query}) ...", flush=True)
        results = search_commons(query)
        if not results:
            print("  NO RESULTS")
            time.sleep(2)
            continue
        # Show all candidates
        for j, r in enumerate(results[:8]):
            print(f"  {j}: {r['width']}x{r['height']} {r['size']//1024}KB {r['title']}")
        # Download top result
        downloaded = False
        for result in results:
            if download_image(result["url"], img_path):
                size = os.path.getsize(img_path) // 1024
                print(f"  -> Downloaded {size}KB - {result['title']}")
                downloaded = True
                break
        if not downloaded: print("  FAILED")
        else: success += 1
        time.sleep(4)
    print(f"\nDone: {success}/{len(CELEBRITIES)}")

if __name__ == "__main__":
    main()
