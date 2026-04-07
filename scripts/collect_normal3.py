"""Download photos for sumo wrestlers, Olympic athletes, soccer players, etc.
Goal: push mean DOWN and stdev UP so top beauty reaches 偏差値 70+."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

CELEBRITIES = [
    # ========== 力士 (sumo wrestlers - well-represented on Wikimedia) ==========
    ("白鵬翔", "sumo", "Hakuho sumo wrestler"),
    ("朝青龍明徳", "sumo", "Asashoryu sumo wrestler"),
    ("稀勢の里寛", "sumo", "Kisenosato sumo wrestler"),
    ("貴景勝光信", "sumo", "Takakeisho sumo wrestler"),
    ("照ノ富士春雄", "sumo", "Terunofuji sumo wrestler"),
    ("琴奨菊和弘", "sumo", "Kotoshogiku sumo wrestler"),
    ("鶴竜力三郎", "sumo", "Kakuryu sumo wrestler"),
    ("日馬富士公平", "sumo", "Harumafuji sumo wrestler"),
    ("栃ノ心剛史", "sumo", "Tochinoshin sumo wrestler"),
    ("逸ノ城駿", "sumo", "Ichinojo sumo wrestler"),
    ("遠藤聖大", "sumo", "Endo sumo wrestler"),
    ("正代直也", "sumo", "Shodai sumo wrestler"),
    ("御嶽海久司", "sumo", "Mitakeumi sumo wrestler"),
    ("玉鷲一朗", "sumo", "Tamawashi sumo wrestler"),
    ("高安晃", "sumo", "Takayasu sumo wrestler"),
    ("阿炎政竜", "sumo", "Abi sumo wrestler"),
    ("翔猿正也", "sumo", "Tobizaru sumo wrestler"),
    ("霧馬山鐵雄", "sumo", "Kiribayama sumo wrestler"),
    ("豊昇龍智勝", "sumo", "Hoshoryu sumo wrestler"),
    ("大栄翔勇人", "sumo", "Daieisho sumo wrestler"),

    # ========== オリンピック選手 ==========
    ("北島康介", "athlete", "Kosuke Kitajima swimmer Olympic"),
    ("内村航平", "athlete", "Kohei Uchimura gymnast Olympic"),
    ("野村忠宏", "athlete", "Tadahiro Nomura judo Olympic"),
    ("谷亮子", "athlete", "Ryoko Tani judo Olympic"),
    ("阿部一二三", "athlete", "Hifumi Abe judo Olympic"),
    ("阿部詩", "athlete", "Uta Abe judo Olympic"),
    ("橋本大輝", "athlete", "Daiki Hashimoto gymnast Olympic"),
    ("堀米雄斗", "athlete", "Yuto Horigome skateboard Olympic"),

    # ========== 野球レジェンド ==========
    ("王貞治", "athlete", "Sadaharu Oh baseball"),
    ("長嶋茂雄", "athlete", "Shigeo Nagashima baseball"),
    ("野茂英雄", "athlete", "Hideo Nomo baseball pitcher"),

    # ========== サッカー選手 ==========
    ("中村俊輔", "athlete", "Shunsuke Nakamura footballer"),
    ("遠藤保仁", "athlete", "Yasuhito Endo footballer"),
    ("長谷部誠", "athlete", "Makoto Hasebe footballer"),
    ("岡崎慎司", "athlete", "Shinji Okazaki footballer"),
    ("吉田麻也", "athlete", "Maya Yoshida footballer"),
    ("冨安健洋", "athlete", "Takehiro Tomiyasu footballer"),
    ("南野拓実", "athlete", "Takumi Minamino footballer"),
    ("鎌田大地", "athlete", "Daichi Kamada footballer"),

    # ========== お笑い芸人 ==========
    ("小籔千豊", "comedian", "Koyabu Kazutoyo comedian"),
    ("宮川大輔", "comedian", "Miyagawa Daisuke comedian"),
    ("千原ジュニア", "comedian", "Chihara Junior comedian"),
    ("千原せいじ", "comedian", "Chihara Seiji comedian"),
    ("中川家礼二", "comedian", "Nakagawake Reiji comedian"),
    ("中川家剛", "comedian", "Nakagawake Tsuyoshi comedian"),
    ("笑い飯哲夫", "comedian", "Warai Meshi Tetsuo comedian"),

    # ========== プロレスラー ==========
    ("棚橋弘至", "prowrestler", "Hiroshi Tanahashi wrestler NJPW"),
    ("オカダカズチカ", "prowrestler", "Kazuchika Okada wrestler NJPW"),

    # ========== ミュージシャン ==========
    ("秦基博", "musician", "Motohiro Hata musician singer"),
    ("槇原敬之", "musician", "Noriyuki Makihara singer"),
    ("つんく", "musician", "Tsunku producer singer"),
    ("小室哲哉", "musician", "Tetsuya Komuro musician producer"),
    ("桑田佳祐", "musician", "Keisuke Kuwata Southern All Stars musician"),

    # ========== 映画監督・文化人 ==========
    ("宮崎駿", "cultural", "Hayao Miyazaki director animator"),
    ("是枝裕和", "cultural", "Hirokazu Koreeda director filmmaker"),
    ("庵野秀明", "cultural", "Hideaki Anno director Evangelion"),
]

EXISTING = set()
if os.path.isdir(OUTPUT_DIR):
    for name in os.listdir(OUTPUT_DIR):
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
            # Prefer portrait-ish images
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
    failed = []
    skipped = []
    for i, (name, category, query) in enumerate(CELEBRITIES):
        if name in EXISTING:
            print(f"[{i+1}/{len(CELEBRITIES)}] {name} - SKIP (already exists)")
            skipped.append(name)
            continue
        person_dir = os.path.join(OUTPUT_DIR, name)
        os.makedirs(person_dir, exist_ok=True)
        img_path = os.path.join(person_dir, "photo.jpg")
        cat_path = os.path.join(person_dir, "category.txt")
        if os.path.exists(img_path) and os.path.getsize(img_path) > 10000:
            print(f"[{i+1}/{len(CELEBRITIES)}] {name} - already have photo, skip")
            success += 1
            continue
        print(f"[{i+1}/{len(CELEBRITIES)}] {name} ({query}) ...", flush=True)
        results = search_commons(query)
        if not results:
            print(f"  NO RESULTS")
            failed.append(name)
            time.sleep(2)
            continue
        for j, r in enumerate(results[:3]):
            print(f"  {j}: {r['width']}x{r['height']} {r['size']//1024}KB {r['title'][:60]}")
        downloaded = False
        for result in results:
            if download_image(result["url"], img_path):
                size = os.path.getsize(img_path) // 1024
                print(f"  -> Downloaded {size}KB")
                downloaded = True
                break
        if not downloaded:
            print("  FAILED")
            failed.append(name)
        else:
            with open(cat_path, "w", encoding="utf-8") as f:
                f.write(category)
            success += 1
        time.sleep(3)
    print(f"\nDone: {success} downloaded, {len(skipped)} skipped, {len(failed)} failed")
    if failed:
        print(f"Failed ({len(failed)}): {', '.join(failed)}")


if __name__ == "__main__":
    main()
