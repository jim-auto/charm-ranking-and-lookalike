"""Download photos for ~50 non-beauty celebrities to broaden score distribution.
Goal: add comedians, athletes, politicians, etc. so top-tier beauty reaches 偏差値70-80."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

# ~60 candidates (expecting some failures, targeting ~50)
CELEBRITIES = [
    # お笑い芸人 (male)
    ("千鳥大悟", "comedian", "Daigo Chidori comedian"),
    ("千鳥ノブ", "comedian", "Nobu Chidori comedian"),
    ("サンドウィッチマン伊達", "comedian", "Date Mikio Sandwich Man comedian"),
    ("サンドウィッチマン富澤", "comedian", "Tomizawa Takeshi Sandwich Man comedian"),
    ("かまいたち山内", "comedian", "Yamauchi Kentaro Kamaitachi comedian"),
    ("かまいたち濱家", "comedian", "Hamaie Takashi Kamaitachi comedian"),
    ("有吉弘行", "comedian", "Ariyoshi Hiroiki comedian"),
    ("松本人志", "comedian", "Matsumoto Hitoshi Downtown comedian"),
    ("明石家さんま", "comedian", "Akashiya Sanma comedian"),
    ("出川哲朗", "comedian", "Degawa Tetsuro comedian"),
    ("バナナマン設楽", "comedian", "Shitara Osamu Bananaman comedian"),
    ("バナナマン日村", "comedian", "Himura Yuki Bananaman comedian"),
    ("オードリー春日", "comedian", "Kasuga Toshiaki Audrey comedian"),
    ("オードリー若林", "comedian", "Wakabayashi Masayasu Audrey comedian"),
    ("ナイナイ岡村", "comedian", "Okamura Takashi Ninety-Nine comedian"),
    ("博多華丸", "comedian", "Hakata Hanamaru comedian"),
    ("陣内智則", "comedian", "Jinnai Tomonori comedian"),
    ("東野幸治", "comedian", "Higashino Koji comedian"),
    ("ケンドーコバヤシ", "comedian", "Kendo Kobayashi comedian"),
    ("霜降り明星せいや", "comedian", "Seiya Shimofuri Myojo comedian"),
    ("霜降り明星粗品", "comedian", "Soshina Shimofuri Myojo comedian"),

    # お笑い芸人 (female)
    ("いとうあさこ", "comedian", "Ito Asako comedian"),
    ("友近", "comedian", "Tomochika comedian Japan"),
    ("ハリセンボン近藤春菜", "comedian", "Kondo Haruna Harisenbon comedian"),
    ("大久保佳代子", "comedian", "Okubo Kayoko comedian"),
    ("横澤夏子", "comedian", "Yokozawa Natsuko comedian"),
    ("ガンバレルーヤよしこ", "comedian", "Yoshiko Gambareleya comedian"),
    ("ブルゾンちえみ", "comedian", "Blouson Chiemi comedian"),
    ("丸山桂里奈", "comedian", "Maruyama Karina comedian"),

    # スポーツ選手
    ("錦織圭", "athlete", "Kei Nishikori tennis"),
    ("内田篤人", "athlete", "Uchida Atsuto soccer"),
    ("長友佑都", "athlete", "Nagatomo Yuto soccer"),
    ("ダルビッシュ有", "athlete", "Yu Darvish baseball"),
    ("大谷翔平", "athlete", "Shohei Ohtani baseball"),
    ("イチロー", "athlete", "Ichiro Suzuki baseball"),
    ("松山英樹", "athlete", "Hideki Matsuyama golf"),
    ("桃田賢斗", "athlete", "Momota Kento badminton"),
    ("張本智和", "athlete", "Harimoto Tomokazu table tennis"),
    ("井上尚弥", "athlete", "Naoya Inoue boxing"),
    ("浅田真央", "athlete", "Mao Asada figure skating"),
    ("伊藤美誠", "athlete", "Ito Mima table tennis"),
    ("池江璃花子", "athlete", "Ikee Rikako swimming"),
    ("吉田沙保里", "athlete", "Saori Yoshida wrestling"),

    # 政治家・文化人
    ("小泉進次郎", "politician", "Shinjiro Koizumi politician"),
    ("河野太郎", "politician", "Taro Kono politician Japan"),
    ("安倍晋三", "politician", "Shinzo Abe prime minister Japan"),
    ("麻生太郎", "politician", "Taro Aso politician Japan"),
    ("小池百合子", "politician", "Yuriko Koike governor Tokyo"),
    ("蓮舫", "politician", "Renho politician Japan"),
    ("林修", "cultural", "Hayashi Osamu teacher television"),
    ("マツコ・デラックス", "cultural", "Matsuko Deluxe television"),
    ("池上彰", "cultural", "Ikegami Akira journalist"),

    # アナウンサー・キャスター
    ("水卜麻美", "announcer", "Miura Asami announcer NTV"),
    ("弘中綾香", "announcer", "Hironaka Ayaka announcer"),
    ("田中みな実", "announcer", "Tanaka Minami announcer"),
    ("有働由美子", "announcer", "Udo Yumiko announcer NHK"),

    # 一般的な見た目のYouTuber
    ("中田敦彦", "youtuber", "Nakata Atsuhiko YouTube University"),
    ("宮迫博之", "comedian", "Miyasako Hiroyuki comedian"),
    ("江頭2-50", "comedian", "Egashira 2:50 comedian"),
    ("カジサック", "comedian", "Kajisac comedian YouTuber"),
]

# Names already in input_images - skip these
EXISTING = set()
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
        for j, r in enumerate(results[:5]):
            print(f"  {j}: {r['width']}x{r['height']} {r['size']//1024}KB {r['title']}")
        downloaded = False
        for result in results:
            if download_image(result["url"], img_path):
                size = os.path.getsize(img_path) // 1024
                print(f"  -> Downloaded {size}KB - {result['title']}")
                downloaded = True
                break
        if not downloaded:
            print("  FAILED")
            failed.append(name)
        else:
            # Write category file
            with open(cat_path, "w", encoding="utf-8") as f:
                f.write(category)
            success += 1
        time.sleep(4)
    print(f"\nDone: {success} downloaded, {len(skipped)} skipped, {len(failed)} failed")
    if failed:
        print(f"Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
