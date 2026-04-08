"""Collect celebrity face photos using Bing Image Search via icrawler."""
import os, sys, shutil, tempfile
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from icrawler.builtin import BingImageCrawler

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

# (dir_name, category, search_query, gender)
CELEBRITIES = [
    # === 芸人 ===
    ("ナイナイ矢部", "comedian", "矢部浩之 顔", "male"),
    ("ブラマヨ小杉", "comedian", "小杉竜一 ブラックマヨネーズ", "male"),
    ("ブラマヨ吉田", "comedian", "吉田敬 ブラックマヨネーズ", "male"),
    ("フット後藤", "comedian", "後藤輝基 フットボールアワー", "male"),
    ("チュート徳井", "comedian", "徳井義実", "male"),
    ("アンタ山崎", "comedian", "山崎弘也 アンタッチャブル", "male"),
    ("アンタ柴田", "comedian", "柴田英嗣 アンタッチャブル", "male"),
    ("田村亮", "comedian", "田村亮 ロンドンブーツ", "male"),
    ("小籔千豊", "comedian", "小籔千豊", "male"),
    ("中川家礼二", "comedian", "中川家礼二", "male"),
    ("笑い飯哲夫", "comedian", "笑い飯 哲夫", "male"),
    ("アンガ田中", "comedian", "田中卓志 アンガールズ", "male"),
    ("島田紳助", "comedian", "島田紳助", "male"),
    ("志村けん", "comedian", "志村けん", "male"),
    ("萩本欽一", "comedian", "萩本欽一", "male"),
    ("所ジョージ", "comedian", "所ジョージ タレント", "male"),
    ("タモリ", "comedian", "タモリ", "male"),
    ("ミルクボーイ駒場", "comedian", "ミルクボーイ 駒場孝", "male"),
    ("見取り図盛山", "comedian", "見取り図 盛山晋太郎", "male"),
    ("錦鯉長谷川", "comedian", "錦鯉 長谷川雅紀", "male"),
    ("ウエストランド井口", "comedian", "ウエストランド 井口浩之", "male"),
    ("おぎやはぎ小木", "comedian", "小木博明 おぎやはぎ", "male"),
    ("おぎやはぎ矢作", "comedian", "矢作兼 おぎやはぎ", "male"),
    ("NON STYLE井上", "comedian", "井上裕介 NON STYLE", "male"),
    ("品川祐", "comedian", "品川祐 品川庄司", "male"),
    ("藤本敏史", "comedian", "藤本敏史 FUJIWARA", "male"),
    ("三四郎小宮", "comedian", "小宮浩信 三四郎", "male"),
    ("バカリズム", "comedian", "バカリズム", "male"),
    ("劇団ひとり", "comedian", "劇団ひとり", "male"),
    ("山里亮太", "comedian", "山里亮太", "male"),
    ("児嶋一哉", "comedian", "児嶋一哉 アンジャッシュ", "male"),
    ("渡部建", "comedian", "渡部建 アンジャッシュ", "male"),
    ("加藤浩次", "comedian", "加藤浩次 極楽とんぼ", "male"),
    ("ヒロミ", "comedian", "ヒロミ タレント", "male"),
    ("上沼恵美子", "comedian", "上沼恵美子", "female"),
    ("横澤夏子", "comedian", "横澤夏子", "female"),
    ("柳原可奈子", "comedian", "柳原可奈子", "female"),
    ("ゆりやんレトリィバァ", "comedian", "ゆりやんレトリィバァ", "female"),

    # === スポーツ (未取得分) ===
    ("琴ノ若傑太", "sumo", "琴ノ若 力士", "male"),
    ("朝乃山英樹", "sumo", "朝乃山 力士", "male"),
    ("大坂なおみ", "athlete", "大坂なおみ テニス", "female"),
    ("福原愛", "athlete", "福原愛 卓球", "female"),
    ("三浦知良", "athlete", "三浦知良 サッカー", "male"),
    ("高梨沙羅", "athlete", "高梨沙羅 スキージャンプ", "female"),
    ("上野由岐子", "athlete", "上野由岐子 ソフトボール", "female"),
    ("三笘薫", "athlete", "三笘薫 サッカー", "male"),
    ("久保建英", "athlete", "久保建英 サッカー", "male"),
    ("堂安律", "athlete", "堂安律 サッカー", "male"),
    ("佐々木朗希", "athlete", "佐々木朗希 野球", "male"),
    ("阿部一二三", "athlete", "阿部一二三 柔道", "male"),
    ("阿部詩", "athlete", "阿部詩 柔道", "female"),
    ("落合博満", "athlete", "落合博満", "male"),
    ("古田敦也", "athlete", "古田敦也", "male"),
    ("青木宣親", "athlete", "青木宣親 野球", "male"),
    ("原辰徳", "athlete", "原辰徳", "male"),
    ("橋本大輝", "athlete", "橋本大輝 体操", "male"),
    ("武尊", "athlete", "武尊 格闘家", "male"),
    ("魔裟斗", "athlete", "魔裟斗 K-1", "male"),

    # === 文化人 ===
    ("つんく", "cultural", "つんく♂", "male"),
    ("黒柳徹子", "cultural", "黒柳徹子", "female"),
    ("和田アキ子", "cultural", "和田アキ子", "female"),

    # === 俳優・女優 (追加) ===
    ("松本潤", "actor", "松本潤 嵐", "male"),
    ("二宮和也", "actor", "二宮和也 嵐", "male"),
    ("櫻井翔", "actor", "櫻井翔 嵐", "male"),
    ("相葉雅紀", "actor", "相葉雅紀 嵐", "male"),
    ("大野智", "actor", "大野智 嵐", "male"),
    ("中居正広", "actor", "中居正広", "male"),
    ("草なぎ剛", "actor", "草彅剛", "male"),
    ("香取慎吾", "actor", "香取慎吾", "male"),
    ("稲垣吾郎", "actor", "稲垣吾郎", "male"),
    ("堺雅人", "actor", "堺雅人 俳優", "male"),
    ("西島秀俊", "actor", "西島秀俊 俳優", "male"),
    ("鈴木亮平", "actor", "鈴木亮平 俳優", "male"),
    ("阿部寛", "actor", "阿部寛 俳優", "male"),
    ("役所広司", "actor", "役所広司 俳優", "male"),
    ("渡辺謙", "actor", "渡辺謙 俳優", "male"),
    ("松たか子", "actress", "松たか子", "female"),
    ("吉永小百合", "actress", "吉永小百合", "female"),
    ("大竹しのぶ", "actress", "大竹しのぶ", "female"),
    ("薬師丸ひろ子", "actress", "薬師丸ひろ子", "female"),
    ("宮沢りえ", "actress", "宮沢りえ", "female"),
    ("柴咲コウ", "actress", "柴咲コウ", "female"),
    ("中谷美紀", "actress", "中谷美紀", "female"),
    ("松嶋菜々子", "actress", "松嶋菜々子", "female"),
    ("仲里依紗", "actress", "仲里依紗", "female"),
    ("桜井日奈子", "actress", "桜井日奈子", "female"),
    ("山本美月", "actress", "山本美月", "female"),
]

EXISTING = set(os.listdir(OUTPUT_DIR))

def main():
    ok = 0
    fail = []
    total = len(CELEBRITIES)

    for i, (name, category, query, gender) in enumerate(CELEBRITIES):
        safe_name = name.replace(":", "-")
        person_dir = os.path.join(OUTPUT_DIR, safe_name)
        img_path = os.path.join(person_dir, "photo.jpg")

        if os.path.exists(img_path) and os.path.getsize(img_path) > 5000:
            continue

        print(f"[{i+1}/{total}] {name} ...", end=" ", flush=True)

        tmpdir = tempfile.mkdtemp()
        try:
            crawler = BingImageCrawler(storage={"root_dir": tmpdir}, log_level=50)
            crawler.crawl(keyword=query, max_num=1)

            files = [f for f in os.listdir(tmpdir) if os.path.getsize(os.path.join(tmpdir, f)) > 3000]
            if files:
                os.makedirs(person_dir, exist_ok=True)
                shutil.copy2(os.path.join(tmpdir, files[0]), img_path)
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
        except Exception as e:
            print(f"ERROR: {e}")
            fail.append(name)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    print(f"\nDone: {ok} downloaded, {len(fail)} failed")
    if fail:
        print(f"Failed ({len(fail)}): {', '.join(fail[:20])}")

if __name__ == "__main__":
    main()
