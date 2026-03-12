"""Collect ~85 more celebrity images from Wikimedia Commons in batches."""

import json
import os
import sys
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "input_images")

# Already have: SANA(TWICE), 橋本環奈, 長澤まさみ, 綾瀬はるか, 浜辺美波, 広瀬すず,
#   新垣結衣, 佐藤健, 山崎賢人, 齋藤飛鳥, はじめしゃちょー, 芦田愛菜, 清原果耶,
#   上白石萌歌, 南沙良, 道枝駿佑, Koki, 与田祐希
# Also in input_images but not in JSON: MOMO(TWICE), HIKAKIN, 中村倫也, 今田美桜,
#   北川景子, 吉沢亮, 岡田准一, 新田真剣佑, 有村架純, 横浜流星, 石原さとみ,
#   福士蒼汰, 竹内涼真, 菅田将暉

CELEBRITIES = [
    # ===== 女優 =====
    ("石原さとみ", "actress", "Ishihara Satomi actress"),
    ("北川景子", "actress", "Kitagawa Keiko actress"),
    ("有村架純", "actress", "Arimura Kasumi actress"),
    ("今田美桜", "actress", "Imada Mio actress"),
    ("吉高由里子", "actress", "Yoshitaka Yuriko actress"),
    ("川口春奈", "actress", "Kawaguchi Haruna actress"),
    ("本田翼", "actress", "Honda Tsubasa actress"),
    ("深田恭子", "actress", "Fukada Kyoko actress"),
    ("桐谷美玲", "actress", "Kiritani Mirei actress"),
    ("佐々木希", "actress", "Sasaki Nozomi actress model"),
    ("土屋太鳳", "actress", "Tsuchiya Tao actress"),
    ("杉咲花", "actress", "Sugisaki Hana actress"),
    ("上白石萌音", "actress", "Kamishiraishi Mone actress"),
    ("松本まりか", "actress", "Matsumoto Marika actress"),
    ("池田エライザ", "actress", "Ikeda Elaiza actress"),
    ("広瀬アリス", "actress", "Hirose Alice actress"),
    ("森川葵", "actress", "Morikawa Aoi actress"),
    ("黒木華", "actress", "Kuroki Haru actress"),
    ("吉岡里帆", "actress", "Yoshioka Riho actress"),
    ("松岡茉優", "actress", "Matsuoka Mayu actress"),
    ("飯豊まりえ", "actress", "Iitoyo Marie actress"),
    ("奈緒", "actress", "Nao actress Japan"),
    ("山本舞香", "actress", "Yamamoto Maika actress"),
    ("小松菜奈", "actress", "Komatsu Nana actress"),
    ("二階堂ふみ", "actress", "Nikaido Fumi actress"),
    ("高畑充希", "actress", "Takahata Mitsuki actress"),
    ("森七菜", "actress", "Mori Nana actress Japan 2023"),
    ("永野芽郁", "actress", "Nagano Mei actress Japan"),
    ("福原遥", "actress", "Fukuhara Haruka actress Japan"),
    ("山田杏奈", "actress", "Yamada Anna actress"),
    ("浜辺美波", "actress", "Hamabe Minami actress"),  # skip - already exists

    # ===== 俳優 =====
    ("菅田将暉", "actor", "Suda Masaki actor"),
    ("横浜流星", "actor", "Yokohama Ryusei actor"),
    ("吉沢亮", "actor", "Yoshizawa Ryo actor"),
    ("新田真剣佑", "actor", "Mackenyu actor"),
    ("竹内涼真", "actor", "Takeuchi Ryoma actor"),
    ("福士蒼汰", "actor", "Fukushi Sota actor"),
    ("中村倫也", "actor", "Nakamura Tomoya actor"),
    ("岡田准一", "actor", "Okada Junichi actor"),
    ("松坂桃李", "actor", "Matsuzaka Tori actor"),
    ("田中圭", "actor", "Tanaka Kei actor"),
    ("玉木宏", "actor", "Tamaki Hiroshi actor"),
    ("三浦翔平", "actor", "Miura Shohei actor"),
    ("千葉雄大", "actor", "Chiba Yudai actor"),
    ("瀬戸康史", "actor", "Seto Koji actor"),
    ("岩田剛典", "actor", "Iwata Takanori actor EXILE"),
    ("間宮祥太朗", "actor", "Mamiya Shotaro actor"),
    ("磯村勇斗", "actor", "Isomura Hayato actor"),
    ("目黒蓮", "idol", "Meguro Ren actor"),
    ("高橋文哉", "actor", "Takahashi Fumiya actor"),
    ("赤楚衛二", "actor", "Akaso Eiji actor"),
    ("眞栄田郷敦", "actor", "Maeda Gordon actor"),
    ("神木隆之介", "actor", "Kamiki Ryunosuke actor"),
    ("坂口健太郎", "actor", "Sakaguchi Kentaro actor"),
    ("中川大志", "actor", "Nakagawa Taishi actor"),
    ("北村匠海", "actor", "Kitamura Takumi actor DISH"),

    # ===== アイドル =====
    ("MOMO(TWICE)", "idol", "TWICE MOMO"),
    ("平野紫耀", "idol", "Hirano Sho King Prince"),
    ("髙橋海人", "idol", "Takahashi Kaito King Prince"),
    ("永瀬廉", "idol", "Nagase Ren idol"),
    ("岸優太", "idol", "Kishi Yuta King Prince"),
    ("松村北斗", "idol", "Matsumura Hokuto SixTONES"),
    ("渡辺翔太", "idol", "Watanabe Shota Snow Man"),
    ("ラウール", "idol", "Raul Snow Man"),
    ("賀喜遥香", "idol", "Kaki Haruka idol"),
    ("遠藤さくら", "idol", "Endo Sakura idol"),
    ("山下美月", "idol", "Yamashita Mizuki Nogizaka46"),
    ("生田絵梨花", "idol", "Ikuta Erika Nogizaka46"),
    ("白石麻衣", "idol", "Shiraishi Mai Nogizaka46"),
    ("西野七瀬", "idol", "Nishino Nanase Nogizaka46"),
    ("指原莉乃", "idol", "Sashihara Rino AKB48"),

    # ===== インフルエンサー =====
    ("HIKAKIN", "influencer", "HIKAKIN YouTuber"),
    ("藤田ニコル", "influencer", "Fujita Nicole model Japan"),
    ("りゅうちぇる", "influencer", "Ryuchell model"),
    ("kemio", "influencer", "kemio YouTuber Japan"),
    ("ゆうこす", "influencer", "Yukos model Japan"),
    ("ローラ", "influencer", "Rola model Japan"),
    ("みちょぱ", "influencer", "Michopa model Japan"),
    ("越智ゆらの", "influencer", "Ochi Yurano model"),

    # ===== イコラブ (=LOVE) =====
    ("齊藤なぎさ", "idol", "Saito Nagisa equal love"),
    ("野口衣織", "idol", "Noguchi Iori equal love"),
    ("大谷映美里", "idol", "Otani Emiri equal love"),
    ("佐々木舞香", "idol", "Sasaki Maika equal love"),
    ("髙松瞳", "idol", "Takamatsu Hitomi equal love"),

    # ===== 日向坂46 =====
    ("小坂菜緒", "idol", "Kosaka Nao Hinatazaka46"),
    ("金村美玖", "idol", "Kanemura Miku Hinatazaka46"),
    ("加藤史帆", "idol", "Kato Shiho Hinatazaka46"),

    # ===== その他アイドル・若手 =====
    ("橋本奈々未", "idol", "Hashimoto Nanami Nogizaka46"),
    ("松田好花", "idol", "Matsuda Konoka Hinatazaka46"),
    ("田中美久", "idol", "Tanaka Miku HKT48"),
    ("本田仁美", "idol", "Honda Hitomi IZ*ONE AKB48"),

    # ===== ノイミー (≠ME) =====
    ("鈴木瞳美", "idol", "Suzuki Hitomi Not Equal Me"),
    ("谷崎早耶", "idol", "Tanizaki Saya Not Equal Me"),
    ("尾木波菜", "idol", "Ogi Hana Not Equal Me"),
    ("冨田菜々風", "idol", "Tomita Nanaho Not Equal Me"),
    ("蟹沢萌子", "idol", "Kanizawa Moeko Not Equal Me"),
    ("河口夏音", "idol", "Kawaguchi Kanon Not Equal Me"),
    ("櫻井もも", "idol", "Sakurai Momo Not Equal Me"),
]


def search_commons(query):
    params = {
        "action": "query", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": query, "gsrlimit": "5", "prop": "imageinfo",
        "iiprop": "url|mime", "iiurlwidth": "800", "format": "json",
    }
    url = f"https://commons.wikimedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if "query" not in data:
                return []
            results = []
            for page in data["query"]["pages"].values():
                if "imageinfo" in page:
                    info = page["imageinfo"][0]
                    mime = info.get("mime", "")
                    if mime.startswith("image/") and "svg" not in mime:
                        results.append({
                            "title": page["title"],
                            "url": info.get("thumburl") or info.get("url"),
                        })
            return results
    except Exception as e:
        print(f"  Search error: {e}")
        return []


def download_image(url, path):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FaceRankingBot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            with open(path, "wb") as f:
                f.write(resp.read())
        return True
    except Exception as e:
        print(f"  DL error: {e}")
        return False


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    success = 0
    skip = 0

    for i, (name, category, query) in enumerate(CELEBRITIES):
        person_dir = os.path.join(OUTPUT_DIR, name)
        os.makedirs(person_dir, exist_ok=True)

        with open(os.path.join(person_dir, "category.txt"), "w", encoding="utf-8") as f:
            f.write(category)

        img_path = os.path.join(person_dir, "photo.jpg")
        if os.path.exists(img_path) and os.path.getsize(img_path) > 1000:
            print(f"[skip] {name}")
            success += 1
            skip += 1
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
                print(f"OK ({size}KB)")
                downloaded = True
                break

        if not downloaded:
            print("FAILED")
        else:
            success += 1

        # Rate limit: longer delay every 5 requests
        delay = 4 if (i - skip) % 5 == 4 else 2
        time.sleep(delay)

    print(f"\nDone: {success}/{len(CELEBRITIES)} images collected")


if __name__ == "__main__":
    main()
