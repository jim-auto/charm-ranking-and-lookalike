"""Retry failed downloads from collect_normal3.py with longer sleep."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

# Only the ones that failed
CELEBRITIES = [
    ("御嶽海久司", "sumo", "Mitakeumi sumo wrestler"),
    ("阿炎政竜", "sumo", "Abi sumo wrestler"),
    ("霧馬山鐵雄", "sumo", "Kiribayama sumo wrestler"),
    ("大栄翔勇人", "sumo", "Daieisho sumo wrestler"),
    ("北島康介", "athlete", "Kosuke Kitajima swimmer Olympic"),
    ("内村航平", "athlete", "Kohei Uchimura gymnast Olympic"),
    ("野村忠宏", "athlete", "Tadahiro Nomura judo Olympic"),
    ("谷亮子", "athlete", "Ryoko Tani judo Olympic"),
    ("阿部一二三", "athlete", "Hifumi Abe judo Olympic"),
    ("阿部詩", "athlete", "Uta Abe judo Olympic"),
    ("橋本大輝", "athlete", "Daiki Hashimoto gymnast Olympic"),
    ("堀米雄斗", "athlete", "Yuto Horigome skateboard Olympic"),
    ("野茂英雄", "athlete", "Hideo Nomo baseball pitcher"),
    ("オカダカズチカ", "prowrestler", "Kazuchika Okada wrestler NJPW"),
    ("是枝裕和", "cultural", "Hirokazu Koreeda director filmmaker"),
]

EXISTING = set()
if os.path.isdir(OUTPUT_DIR):
    for name in os.listdir(OUTPUT_DIR):
        p = os.path.join(OUTPUT_DIR, name, "photo.jpg")
        if os.path.exists(p) and os.path.getsize(p) > 10000:
            EXISTING.add(name)


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
            results.sort(key=lambda r: (
                1 if r["height"] > r["width"] * 0.8 else 0,
                r["size"]
            ), reverse=True)
            return results
    except Exception as e:
        print(f"  Search error: {e}")
        return []


def download_image(url, path):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                with open(path, "wb") as f: f.write(resp.read())
            return True
        except Exception as e:
            print(f"  DL error (attempt {attempt+1}): {e}")
            if attempt < 2:
                time.sleep(10)
    return False


def main():
    success = 0
    failed = []
    for i, (name, category, query) in enumerate(CELEBRITIES):
        if name in EXISTING:
            print(f"[{i+1}/{len(CELEBRITIES)}] {name} - SKIP (already exists)")
            continue
        person_dir = os.path.join(OUTPUT_DIR, name)
        os.makedirs(person_dir, exist_ok=True)
        img_path = os.path.join(person_dir, "photo.jpg")
        cat_path = os.path.join(person_dir, "category.txt")
        print(f"[{i+1}/{len(CELEBRITIES)}] {name} ({query}) ...", flush=True)
        results = search_commons(query)
        if not results:
            print(f"  NO RESULTS")
            failed.append(name)
            time.sleep(5)
            continue
        for j, r in enumerate(results[:3]):
            print(f"  {j}: {r['width']}x{r['height']} {r['size']//1024}KB {r['title'][:60]}")
        downloaded = False
        for result in results[:5]:
            if download_image(result["url"], img_path):
                size = os.path.getsize(img_path) // 1024
                print(f"  -> Downloaded {size}KB")
                downloaded = True
                break
            time.sleep(5)
        if not downloaded:
            print("  FAILED")
            failed.append(name)
        else:
            with open(cat_path, "w", encoding="utf-8") as f:
                f.write(category)
            success += 1
        time.sleep(8)
    print(f"\nDone: {success} downloaded, {len(failed)} failed")
    if failed:
        print(f"Failed ({len(failed)}): {', '.join(failed)}")


if __name__ == "__main__":
    main()
