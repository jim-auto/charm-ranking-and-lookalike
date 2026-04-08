"""Collect celebrity face photos using DuckDuckGo Image Search.
Falls back from Wikipedia API → DuckDuckGo Images."""
import json, os, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

from duckduckgo_search import DDGS

def fetch_wikipedia_image(wiki_title):
    params = {
        "action": "query", "titles": wiki_title, "prop": "pageimages",
        "pithumbsize": "800", "format": "json",
    }
    url = f"https://ja.wikipedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            pages = data.get("query", {}).get("pages", {})
            for page in pages.values():
                thumb = page.get("thumbnail", {}).get("source")
                if thumb:
                    return thumb
    except:
        pass
    return None

def fetch_ddg_image(query):
    """Search DuckDuckGo for a face photo."""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.images(query, max_results=5))
            for r in results:
                url = r.get("image", "")
                if url and any(ext in url.lower() for ext in [".jpg", ".jpeg", ".png"]):
                    return url
    except Exception as e:
        print(f"  DDG error: {e}")
    return None

def download_image(url, path):
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            if len(data) < 3000:
                return False
            with open(path, "wb") as f:
                f.write(data)
        return True
    except:
        return False

# People who failed Wikipedia download - try DDG
# (name_for_dir, category, search_query, gender)
CELEBRITIES = [
    # === 芸人 (Wikipedia画像なし組) ===
    ("ナイナイ矢部", "comedian", "矢部浩之 顔", "male"),
    ("ブラマヨ小杉", "comedian", "小杉竜一 ブラックマヨネーズ 顔", "male"),
    ("ブラマヨ吉田", "comedian", "吉田敬 ブラックマヨネーズ 顔", "male"),
    ("フット後藤", "comedian", "後藤輝基 顔", "male"),
    ("チュート徳井", "comedian", "徳井義実 顔", "male"),
    ("アンタ山崎", "comedian", "山崎弘也 顔", "male"),
    ("アンタ柴田", "comedian", "柴田英嗣 顔", "male"),
    ("田村亮", "comedian", "田村亮 ロンドンブーツ 顔", "male"),
    ("小籔千豊", "comedian", "小籔千豊 顔", "male"),
    ("中川家礼二", "comedian", "中川家礼二 顔", "male"),
    ("笑い飯哲夫", "comedian", "笑い飯 哲夫 顔", "male"),
    ("アンガ田中", "comedian", "田中卓志 アンガールズ 顔", "male"),
    ("島田紳助", "comedian", "島田紳助 顔", "male"),
    ("志村けん", "comedian", "志村けん 顔", "male"),
    ("萩本欽一", "comedian", "萩本欽一 顔", "male"),
    ("所ジョージ", "comedian", "所ジョージ 顔", "male"),
    ("タモリ", "comedian", "タモリ 顔", "male"),
    ("ミルクボーイ駒場", "comedian", "ミルクボーイ 駒場 顔", "male"),
    ("見取り図盛山", "comedian", "見取り図 盛山 顔", "male"),
    ("錦鯉長谷川", "comedian", "錦鯉 長谷川 顔", "male"),
    ("ウエストランド井口", "comedian", "ウエストランド 井口 顔", "male"),
    ("おぎやはぎ小木", "comedian", "小木博明 顔", "male"),
    ("おぎやはぎ矢作", "comedian", "矢作兼 顔", "male"),
    ("NON STYLE井上", "comedian", "井上裕介 NON STYLE 顔", "male"),
    ("品川祐", "comedian", "品川祐 顔", "male"),
    ("藤本敏史", "comedian", "藤本敏史 顔", "male"),
    ("三四郎小宮", "comedian", "小宮浩信 三四郎 顔", "male"),
    ("バカリズム", "comedian", "バカリズム 顔", "male"),
    ("劇団ひとり", "comedian", "劇団ひとり 顔", "male"),
    ("山里亮太", "comedian", "山里亮太 顔", "male"),
    ("児嶋一哉", "comedian", "児嶋一哉 アンジャッシュ 顔", "male"),
    ("渡部建", "comedian", "渡部建 顔", "male"),
    ("加藤浩次", "comedian", "加藤浩次 顔", "male"),
    ("ヒロミ", "comedian", "ヒロミ タレント 顔", "male"),
    ("上沼恵美子", "comedian", "上沼恵美子 顔", "female"),
    ("友近", "comedian", "友近 芸人 顔", "female"),
    ("大久保佳代子", "comedian", "大久保佳代子 顔", "female"),
    ("横澤夏子", "comedian", "横澤夏子 顔", "female"),
    ("渡辺直美", "comedian", "渡辺直美 顔", "female"),

    # === スポーツ (Wikipedia画像なし/429エラー組) ===
    ("琴ノ若傑太", "sumo", "琴ノ若 力士 顔", "male"),
    ("朝乃山英樹", "sumo", "朝乃山 力士 顔", "male"),
    ("大坂なおみ", "athlete", "大坂なおみ テニス 顔", "female"),
    ("福原愛", "athlete", "福原愛 卓球 顔", "female"),
    ("三浦知良", "athlete", "三浦知良 サッカー 顔", "male"),
    ("高梨沙羅", "athlete", "高梨沙羅 スキー 顔", "female"),
    ("上野由岐子", "athlete", "上野由岐子 ソフトボール 顔", "female"),
    ("三笘薫", "athlete", "三笘薫 サッカー 顔", "male"),
    ("久保建英", "athlete", "久保建英 サッカー 顔", "male"),
    ("堂安律", "athlete", "堂安律 サッカー 顔", "male"),
    ("佐々木朗希", "athlete", "佐々木朗希 野球 顔", "male"),
    ("阿部一二三", "athlete", "阿部一二三 柔道 顔", "male"),
    ("阿部詩", "athlete", "阿部詩 柔道 顔", "female"),
    ("落合博満", "athlete", "落合博満 顔", "male"),
    ("古田敦也", "athlete", "古田敦也 顔", "male"),
    ("青木宣親", "athlete", "青木宣親 野球 顔", "male"),
    ("原辰徳", "athlete", "原辰徳 顔", "male"),
    ("橋本大輝", "athlete", "橋本大輝 体操 顔", "male"),
    ("武尊", "athlete", "武尊 格闘家 顔", "male"),
    ("魔裟斗", "athlete", "魔裟斗 K-1 顔", "male"),

    # === 文化人 ===
    ("つんく", "cultural", "つんく 顔", "male"),
    ("黒柳徹子", "cultural", "黒柳徹子 顔", "female"),
    ("和田アキ子", "cultural", "和田アキ子 顔", "female"),

    # === 追加の有名人 ===
    ("松本潤", "actor", "松本潤 嵐 顔", "male"),
    ("二宮和也", "actor", "二宮和也 嵐 顔", "male"),
    ("櫻井翔", "actor", "櫻井翔 嵐 顔", "male"),
    ("相葉雅紀", "actor", "相葉雅紀 嵐 顔", "male"),
    ("大野智", "actor", "大野智 嵐 顔", "male"),
    ("中居正広", "actor", "中居正広 顔", "male"),
    ("草彅剛", "actor", "草彅剛 顔", "male"),
    ("香取慎吾", "actor", "香取慎吾 顔", "male"),
    ("稲垣吾郎", "actor", "稲垣吾郎 顔", "male"),
    ("堺雅人", "actor", "堺雅人 顔", "male"),
    ("西島秀俊", "actor", "西島秀俊 顔", "male"),
    ("鈴木亮平", "actor", "鈴木亮平 俳優 顔", "male"),
    ("阿部寛", "actor", "阿部寛 俳優 顔", "male"),
    ("役所広司", "actor", "役所広司 顔", "male"),
    ("渡辺謙", "actor", "渡辺謙 俳優 顔", "male"),
    ("松たか子", "actress", "松たか子 顔", "female"),
    ("吉永小百合", "actress", "吉永小百合 顔", "female"),
    ("樹木希林", "actress", "樹木希林 顔", "female"),
    ("大竹しのぶ", "actress", "大竹しのぶ 顔", "female"),
    ("薬師丸ひろ子", "actress", "薬師丸ひろ子 顔", "female"),
    ("宮沢りえ", "actress", "宮沢りえ 顔", "female"),
    ("柴咲コウ", "actress", "柴咲コウ 顔", "female"),
    ("中谷美紀", "actress", "中谷美紀 顔", "female"),
    ("竹内結子", "actress", "竹内結子 顔", "female"),
    ("松嶋菜々子", "actress", "松嶋菜々子 顔", "female"),
    ("仲里依紗", "actress", "仲里依紗 顔", "female"),
    ("桜井日奈子", "actress", "桜井日奈子 顔", "female"),
    ("今田美桜", "actress", "今田美桜 顔", "female"),
    ("山本美月", "actress", "山本美月 顔", "female"),
]

EXISTING = set(os.listdir(OUTPUT_DIR))

def main():
    ok = 0
    fail = []
    total = len(CELEBRITIES)
    for i, (name, category, query, gender) in enumerate(CELEBRITIES):
        safe_name = name.replace(":", "-")
        if safe_name in EXISTING:
            # Check if has valid photo
            img = os.path.join(OUTPUT_DIR, safe_name, "photo.jpg")
            if os.path.exists(img) and os.path.getsize(img) > 5000:
                continue

        person_dir = os.path.join(OUTPUT_DIR, safe_name)
        os.makedirs(person_dir, exist_ok=True)
        img_path = os.path.join(person_dir, "photo.jpg")

        if os.path.exists(img_path) and os.path.getsize(img_path) > 5000:
            continue

        print(f"[{i+1}/{total}] {name} ...", end=" ", flush=True)

        # Try DuckDuckGo
        url = fetch_ddg_image(query)
        if url and download_image(url, img_path):
            with open(os.path.join(person_dir, "category.txt"), "w", encoding="utf-8") as f:
                f.write(category)
            with open(os.path.join(person_dir, "gender.txt"), "w", encoding="utf-8") as f:
                f.write(gender)
            sz = os.path.getsize(img_path) // 1024
            print(f"OK ({sz}KB)")
            ok += 1
        else:
            print("FAIL")
            fail.append(name)
        time.sleep(2)

    print(f"\nDone: {ok} downloaded, {len(fail)} failed")
    if fail:
        print(f"Failed: {', '.join(fail[:20])}")

if __name__ == "__main__":
    main()
