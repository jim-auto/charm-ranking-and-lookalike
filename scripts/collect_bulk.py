#!/usr/bin/env python3
"""Bulk collect celebrity images from Japanese Wikipedia article thumbnails."""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "input_images"
USER_AGENT = "FaceRankingBot/1.0 (https://ja.wikipedia.org/)"

SEARCH_HINTS = {
    "sumo": ["力士", "大相撲"],
    "comedian": ["お笑い芸人", "芸人"],
    "athlete": ["スポーツ選手", "選手"],
    "cultural": ["日本", "人物"],
}

ARTICLE_OVERRIDES = {
    "琴ノ若傑太": "琴櫻将傑",
    "朝乃山英樹": "朝乃山広暉",
    "徳勝龍誠": "德勝龍誠",
    "つんく": "つんく♂",
    "マツコデラックス": "マツコ・デラックス",
    "デヴィ夫人": "デヴィ・スカルノ",
    "ザッケローニ": "アルベルト・ザッケローニ",
    "山本KID徳郁": '山本"KID"徳郁',
    "中川家礼二": "礼二",
}

EXTRA_ALIASES = {
    "阿炎政虎": ("阿炎政竜",),
}


@dataclass(frozen=True)
class Person:
    name: str
    category: str
    gender: str
    article: str | None = None
    aliases: tuple[str, ...] = ()


def male(name: str, category: str, article: str | None = None, aliases: tuple[str, ...] = ()) -> Person:
    return Person(name=name, category=category, gender="male", article=article, aliases=aliases)


def female(name: str, category: str, article: str | None = None, aliases: tuple[str, ...] = ()) -> Person:
    return Person(name=name, category=category, gender="female", article=article, aliases=aliases)


SUMO_PEOPLE = [
    male("白鵬翔", "sumo"),
    male("朝青龍明徳", "sumo"),
    male("日馬富士公平", "sumo"),
    male("鶴竜力三郎", "sumo"),
    male("稀勢の里寛", "sumo"),
    male("貴景勝光信", "sumo"),
    male("照ノ富士春雄", "sumo"),
    male("琴奨菊和弘", "sumo"),
    male("豪栄道豪太郎", "sumo"),
    male("栃ノ心剛史", "sumo"),
    male("逸ノ城駿", "sumo"),
    male("正代直也", "sumo"),
    male("御嶽海久司", "sumo"),
    male("玉鷲一朗", "sumo"),
    male("高安晃", "sumo"),
    male("阿炎政虎", "sumo", aliases=("阿炎政竜",)),
    male("翔猿正也", "sumo"),
    male("霧馬山鐵雄", "sumo"),
    male("豊昇龍智勝", "sumo"),
    male("大栄翔勇人", "sumo"),
    male("若隆景渥", "sumo"),
    male("琴ノ若傑太", "sumo"),
    male("朝乃山英樹", "sumo"),
    male("隠岐の海歩", "sumo"),
    male("阿武咲奎也", "sumo"),
    male("北勝富士大輝", "sumo"),
    male("明生力", "sumo"),
    male("遠藤聖大", "sumo"),
    male("竜電剛至", "sumo"),
    male("宝富士大輔", "sumo"),
    male("碧山亘右", "sumo"),
    male("妙義龍泰成", "sumo"),
    male("魁聖一郎", "sumo"),
    male("千代大龍秀政", "sumo"),
    male("石浦将勝", "sumo"),
    male("炎鵬晃", "sumo"),
    male("宇良和輝", "sumo"),
    male("徳勝龍誠", "sumo"),
    male("照強翔輝", "sumo"),
    male("琴勝峰吉成", "sumo"),
    male("大翔鵬清洋", "sumo"),
    male("千代丸一樹", "sumo"),
    male("琴恵光充憲", "sumo"),
    male("若元春港", "sumo"),
    male("錦富士隆聖", "sumo"),
    male("平戸海鍬太", "sumo"),
    male("王鵬幸之介", "sumo"),
    male("熱海富士朝陽", "sumo"),
    male("伯桜鵬哲也", "sumo"),
    male("尊富士弥輝也", "sumo"),
    male("曙太郎", "sumo"),
    male("武蔵丸光洋", "sumo"),
    male("貴乃花光司", "sumo"),
    male("若乃花勝", "sumo"),
    male("琴欧洲勝紀", "sumo"),
    male("把瑠都凱斗", "sumo"),
    male("旭天鵬勝", "sumo"),
    male("嘉風雅継", "sumo"),
    male("栃煌山雄一郎", "sumo"),
    male("松鳳山裕也", "sumo"),
    male("安美錦竜児", "sumo"),
    male("魁皇博之", "sumo"),
    male("琴光喜啓司", "sumo"),
    male("琴錦功宗", "sumo"),
    male("旭富士正也", "sumo"),
    male("北勝海信芳", "sumo"),
    male("千代の富士貢", "sumo"),
    male("北の湖敏満", "sumo"),
    male("大鵬幸喜", "sumo"),
    male("双葉山定次", "sumo"),
    male("隆の里俊英", "sumo"),
    male("旭道山和泰", "sumo"),
    male("舞の海秀平", "sumo"),
    male("寺尾常史", "sumo"),
    male("高見盛精彦", "sumo"),
    male("雅山哲士", "sumo"),
    male("普天王水", "sumo"),
    male("琴勇輝一巖", "sumo"),
    male("佐田の海貴士", "sumo"),
    male("千代翔馬富士雄", "sumo"),
    male("若の里忍", "sumo"),
    male("出島武春", "sumo"),
    male("栃東大裕", "sumo"),
    male("玉乃島新", "sumo"),
    male("豊ノ島大樹", "sumo"),
    male("阿覧欧虎", "sumo"),
    male("蒼国来栄吉", "sumo"),
    male("臥牙丸勝", "sumo"),
    male("栃乃洋泰一", "sumo"),
    male("若荒雄匡也", "sumo"),
    male("豪風旭", "sumo"),
    male("琴龍宏央", "sumo"),
    male("旭秀鵬滉規", "sumo"),
    male("常幸龍貴之", "sumo"),
    male("千代鳳祐樹", "sumo"),
    male("英乃海拓也", "sumo"),
    male("宝香鵬輝", "sumo"),
    male("北青鵬治", "sumo"),
    male("狼雅外喜義", "sumo"),
    male("欧勝馬出気", "sumo"),
    male("錦木徹也", "sumo"),
    male("美ノ海義久", "sumo"),
    male("金峰山晴樹", "sumo"),
]

COMEDIAN_PEOPLE = [
    male("ダウンタウン松本人志", "comedian"),
    male("ダウンタウン浜田雅功", "comedian"),
    male("爆笑問題太田光", "comedian"),
    male("爆笑問題田中裕二", "comedian"),
    male("くりぃむしちゅー上田晋也", "comedian"),
    male("くりぃむしちゅー有田哲平", "comedian"),
    male("ナインティナイン矢部浩之", "comedian"),
    male("タカアンドトシ", "comedian"),
    male("ブラックマヨネーズ小杉竜一", "comedian"),
    male("ブラックマヨネーズ吉田敬", "comedian"),
    male("フットボールアワー後藤輝基", "comedian"),
    male("チュートリアル徳井義実", "comedian"),
    male("アンタッチャブル山崎弘也", "comedian"),
    male("アンタッチャブル柴田英嗣", "comedian"),
    male("ロンドンブーツ田村淳", "comedian"),
    male("ロンドンブーツ田村亮", "comedian"),
    male("千原ジュニア", "comedian"),
    male("千原せいじ", "comedian"),
    male("宮川大輔", "comedian"),
    male("小籔千豊", "comedian"),
    male("中川家礼二", "comedian"),
    male("中川家剛", "comedian"),
    male("笑い飯哲夫", "comedian"),
    male("ミルクボーイ駒場孝", "comedian"),
    male("ミルクボーイ内海崇", "comedian"),
    male("見取り図盛山晋太郎", "comedian"),
    male("見取り図リリー", "comedian"),
    male("錦鯉長谷川雅紀", "comedian"),
    male("錦鯉渡辺隆", "comedian"),
    male("ウエストランド井口浩之", "comedian"),
    male("アンガールズ田中卓志", "comedian"),
    male("おぎやはぎ小木博明", "comedian"),
    male("おぎやはぎ矢作兼", "comedian"),
    male("NON STYLE井上裕介", "comedian"),
    male("品川祐", "comedian"),
    male("藤本敏史", "comedian"),
    male("三四郎小宮浩信", "comedian"),
    female("ゆりやんレトリィバァ", "comedian"),
    female("柳原可奈子", "comedian"),
    female("近藤春菜", "comedian"),
    male("バイきんぐ小峠英二", "comedian"),
    male("ジャングルポケット斉藤慎二", "comedian"),
    male("かまいたち山内健司", "comedian"),
    male("かまいたち濱家隆一", "comedian"),
    male("霜降り明星せいや", "comedian"),
    male("霜降り明星粗品", "comedian"),
    male("あばれる君", "comedian"),
    male("狩野英孝", "comedian"),
    male("小島よしお", "comedian"),
    male("とにかく明るい安村", "comedian"),
    male("ヒロシ", "comedian"),
    male("サンシャイン池崎", "comedian"),
    male("陣内智則", "comedian"),
    male("東野幸治", "comedian"),
    male("有吉弘行", "comedian"),
    male("バナナマン設楽統", "comedian"),
    male("バナナマン日村勇紀", "comedian"),
    male("オードリー春日俊彰", "comedian"),
    male("オードリー若林正恭", "comedian"),
    male("博多華丸", "comedian"),
    male("今田耕司", "comedian"),
    male("千鳥大悟", "comedian"),
    male("千鳥ノブ", "comedian"),
    male("博多大吉", "comedian"),
    male("ケンドーコバヤシ", "comedian"),
    male("出川哲朗", "comedian"),
    male("バカリズム", "comedian"),
    male("劇団ひとり", "comedian"),
    male("山里亮太", "comedian"),
    female("友近", "comedian"),
    female("いとうあさこ", "comedian"),
    female("大島美幸", "comedian"),
    female("黒沢かずこ", "comedian"),
    female("村上知子", "comedian"),
    female("箕輪はるか", "comedian"),
    male("ロッチ中岡創一", "comedian"),
    male("ロッチコカドケンタロウ", "comedian"),
    male("ハライチ岩井勇気", "comedian"),
    male("ハライチ澤部佑", "comedian"),
    male("さまぁ〜ず三村マサカズ", "comedian"),
    male("さまぁ〜ず大竹一樹", "comedian"),
    male("ネプチューン名倉潤", "comedian"),
    male("ネプチューン原田泰造", "comedian"),
    male("ネプチューン堀内健", "comedian"),
    male("東京03飯塚悟志", "comedian"),
    male("東京03角田晃広", "comedian"),
    male("東京03豊本明長", "comedian"),
    male("ジャルジャル後藤淳平", "comedian"),
    male("ジャルジャル福徳秀介", "comedian"),
    male("チョコレートプラネット長田庄平", "comedian"),
    male("チョコレートプラネット松尾駿", "comedian"),
    male("マヂカルラブリー野田クリスタル", "comedian"),
    male("マヂカルラブリー村上", "comedian"),
    male("麒麟川島明", "comedian"),
    male("オズワルド伊藤俊介", "comedian"),
    male("オズワルド畠中悠", "comedian"),
    male("シソンヌ長谷川忍", "comedian"),
    male("シソンヌじろう", "comedian"),
    male("ニューヨーク屋敷裕政", "comedian"),
    male("ニューヨーク嶋佐和也", "comedian"),
    male("さらば青春の光森田哲矢", "comedian"),
    male("さらば青春の光東ブクロ", "comedian"),
    male("ダイアン津田篤宏", "comedian"),
    male("ダイアンユースケ", "comedian"),
    male("トレンディエンジェル斎藤司", "comedian"),
    male("トレンディエンジェルたかし", "comedian"),
    male("ロバート秋山竜次", "comedian"),
    male("ロバート馬場裕之", "comedian"),
    male("ロバート山本博", "comedian"),
    male("EXIT兼近大樹", "comedian"),
    male("EXITりんたろー。", "comedian"),
    male("かが屋加賀翔", "comedian"),
    male("かが屋賀屋壮也", "comedian"),
    male("和牛水田信二", "comedian"),
    male("和牛川西賢志郎", "comedian"),
    male("銀シャリ橋本直", "comedian"),
    male("銀シャリ鰻和弘", "comedian"),
    male("コロコロチキチキペッパーズナダル", "comedian"),
    male("コロコロチキチキペッパーズ西野創人", "comedian"),
    male("ジャングルポケット太田博久", "comedian"),
    male("ジャングルポケットおたけ", "comedian"),
    male("パンサー向井慧", "comedian"),
    male("パンサー尾形貴弘", "comedian"),
    male("パンサー菅良太郎", "comedian"),
    male("ハナコ岡部大", "comedian"),
    male("ハナコ秋山寛貴", "comedian"),
    male("ハナコ菊田竜大", "comedian"),
    male("ぺこぱ松陰寺太勇", "comedian"),
    male("ぺこぱシュウペイ", "comedian"),
    male("メイプル超合金カズレーザー", "comedian"),
    female("メイプル超合金安藤なつ", "comedian"),
    female("ぼる塾田辺智加", "comedian"),
    female("ぼる塾あんり", "comedian"),
    female("ぼる塾きりやはるか", "comedian"),
    female("やす子", "comedian"),
    female("エルフ荒川", "comedian"),
    female("エルフはる", "comedian"),
    male("真空ジェシカガク", "comedian"),
    male("真空ジェシカ川北茂澄", "comedian"),
    male("令和ロマン高比良くるま", "comedian"),
    male("令和ロマン松井ケムリ", "comedian"),
    male("内村光良", "comedian"),
    male("南原清隆", "comedian"),
    male("サンドウィッチマン伊達みきお", "comedian"),
    male("サンドウィッチマン富澤たけし", "comedian"),
    male("カンニング竹山", "comedian"),
    male("アンジャッシュ渡部建", "comedian"),
    male("アンジャッシュ児嶋一哉", "comedian"),
    male("加藤浩次", "comedian"),
]

ATHLETE_PEOPLE = [
    male("中村俊輔", "athlete"),
    male("遠藤保仁", "athlete"),
    male("長谷部誠", "athlete"),
    male("岡崎慎司", "athlete"),
    male("酒井宏樹", "athlete"),
    male("柴崎岳", "athlete"),
    male("浅野拓磨", "athlete"),
    male("三浦知良", "athlete"),
    male("中田英寿", "athlete"),
    male("本田圭佑", "athlete"),
    male("香川真司", "athlete"),
    male("三笘薫", "athlete"),
    male("久保建英", "athlete"),
    male("田中碧", "athlete"),
    male("堂安律", "athlete"),
    male("冨安健洋", "athlete"),
    male("南野拓実", "athlete"),
    male("鎌田大地", "athlete"),
    male("守田英正", "athlete"),
    male("伊東純也", "athlete"),
    male("前田大然", "athlete"),
    male("上田綺世", "athlete"),
    male("権田修一", "athlete"),
    male("板倉滉", "athlete"),
    male("吉田麻也", "athlete"),
    male("長友佑都", "athlete"),
    male("川島永嗣", "athlete"),
    male("岡田武史", "athlete"),
    male("森保一", "athlete"),
    male("ザッケローニ", "athlete"),
    male("王貞治", "athlete"),
    male("長嶋茂雄", "athlete"),
    male("野茂英雄", "athlete"),
    male("松坂大輔", "athlete"),
    male("斎藤佑樹", "athlete"),
    male("坂本勇人", "athlete"),
    male("村上宗隆", "athlete"),
    male("吉田正尚", "athlete"),
    male("栗山英樹", "athlete"),
    male("大谷翔平", "athlete"),
    male("菊池涼介", "athlete"),
    male("筒香嘉智", "athlete"),
    male("鈴木誠也", "athlete"),
    male("近藤健介", "athlete"),
    male("山田哲人", "athlete"),
    male("柳田悠岐", "athlete"),
    male("前田健太", "athlete"),
    male("田中将大", "athlete"),
    male("藤浪晋太郎", "athlete"),
    male("佐々木朗希", "athlete"),
    male("山本由伸", "athlete"),
    male("今永昇太", "athlete"),
    male("千賀滉大", "athlete"),
    male("吉田輝星", "athlete"),
    male("清宮幸太郎", "athlete"),
    male("中田翔", "athlete"),
    male("丸佳浩", "athlete"),
    male("秋山翔吾", "athlete"),
    male("青木宣親", "athlete"),
    male("松井秀喜", "athlete"),
    male("イチロー", "athlete"),
    male("新庄剛志", "athlete"),
    male("落合博満", "athlete"),
    male("野村克也", "athlete"),
    male("金田正一", "athlete"),
    male("張本勲", "athlete"),
    male("衣笠祥雄", "athlete"),
    male("星野仙一", "athlete"),
    male("原辰徳", "athlete"),
    male("古田敦也", "athlete"),
    male("野村忠宏", "athlete"),
    female("谷亮子", "athlete"),
    male("井上康生", "athlete"),
    male("阿部一二三", "athlete"),
    female("阿部詩", "athlete"),
    male("大野将平", "athlete"),
    male("ウルフアロン", "athlete"),
    male("永瀬貴規", "athlete"),
    male("朝倉未来", "athlete"),
    male("朝倉海", "athlete"),
    male("那須川天心", "athlete"),
    male("武尊", "athlete"),
    male("堀口恭司", "athlete"),
    male("青木真也", "athlete"),
    male("五味隆典", "athlete"),
    male("山本KID徳郁", "athlete"),
    male("魔裟斗", "athlete"),
    male("須藤元気", "athlete"),
    male("武藤敬司", "athlete"),
    male("棚橋弘至", "athlete"),
    male("北島康介", "athlete"),
    male("内村航平", "athlete"),
    male("橋本大輝", "athlete"),
    male("堀米雄斗", "athlete"),
    male("桐生祥秀", "athlete"),
    male("山縣亮太", "athlete"),
    male("萩野公介", "athlete"),
    male("瀬戸大也", "athlete"),
    male("室伏広治", "athlete"),
    female("石川佳純", "athlete"),
    female("福原愛", "athlete"),
    female("高梨沙羅", "athlete"),
    female("上野由岐子", "athlete"),
    male("羽生結弦", "athlete"),
    male("宇野昌磨", "athlete"),
    female("紀平梨花", "athlete"),
    female("大坂なおみ", "athlete"),
    male("八村塁", "athlete"),
    male("渡辺雄太", "athlete"),
    male("五十嵐カノア", "athlete"),
    male("松山英樹", "athlete"),
    male("錦織圭", "athlete"),
    female("池江璃花子", "athlete"),
    female("伊藤美誠", "athlete"),
    male("張本智和", "athlete"),
    male("井上尚弥", "athlete"),
    female("吉田沙保里", "athlete"),
    male("桃田賢斗", "athlete"),
    male("渡辺勇大", "athlete"),
    female("奥原希望", "athlete"),
    male("遠藤航", "athlete"),
    male("内田篤人", "athlete"),
    male("中澤佑二", "athlete"),
    male("中山雅史", "athlete"),
    male("小野伸二", "athlete"),
    male("稲本潤一", "athlete"),
    male("楢崎正剛", "athlete"),
    male("川口能活", "athlete"),
    male("城彰二", "athlete"),
    male("大迫勇也", "athlete"),
    male("原口元気", "athlete"),
    male("乾貴士", "athlete"),
    male("中村憲剛", "athlete"),
    male("中村敬斗", "athlete"),
    male("伊藤洋輝", "athlete"),
    male("毎熊晟矢", "athlete"),
    male("菅原由勢", "athlete"),
    male("鈴木彩艶", "athlete"),
    male("町田浩樹", "athlete"),
    male("谷口彰悟", "athlete"),
    male("谷晃生", "athlete"),
    male("相馬勇紀", "athlete"),
    male("旗手怜央", "athlete"),
    male("植田直通", "athlete"),
    male("小川航基", "athlete"),
    male("前川黛也", "athlete"),
    female("長谷川唯", "athlete"),
    female("熊谷紗希", "athlete"),
    female("岩渕真奈", "athlete"),
    female("清水梨紗", "athlete"),
    female("宮澤ひなた", "athlete"),
    female("谷川萌々子", "athlete"),
    female("藤野あおば", "athlete"),
    male("ダルビッシュ有", "athlete"),
    male("菅野智之", "athlete"),
    male("岡本和真", "athlete"),
    male("牧秀悟", "athlete"),
    male("佐藤輝明", "athlete"),
    male("山川穂高", "athlete"),
    male("山崎康晃", "athlete"),
    male("戸郷翔征", "athlete"),
    male("宮城大弥", "athlete"),
    male("高橋由伸", "athlete"),
    male("阿部慎之助", "athlete"),
    male("上原浩治", "athlete"),
    male("黒田博樹", "athlete"),
    male("岩隈久志", "athlete"),
    male("工藤公康", "athlete"),
    male("桑田真澄", "athlete"),
    male("清原和博", "athlete"),
    male("江川卓", "athlete"),
    male("松中信彦", "athlete"),
    male("小久保裕紀", "athlete"),
    male("城島健司", "athlete"),
    male("立浪和義", "athlete"),
    male("岩瀬仁紀", "athlete"),
    male("福留孝介", "athlete"),
    male("稲葉篤紀", "athlete"),
    male("山本昌", "athlete"),
    male("和田毅", "athlete"),
    male("内海哲也", "athlete"),
    male("斉藤和巳", "athlete"),
    male("涌井秀章", "athlete"),
    male("中村剛也", "athlete"),
    male("松井稼頭央", "athlete"),
    male("西岡剛", "athlete"),
    male("前田智徳", "athlete"),
    male("秋山幸二", "athlete"),
    male("山本浩二", "athlete"),
    male("山田久志", "athlete"),
    male("井岡一翔", "athlete"),
    male("村田諒太", "athlete"),
    male("長谷川穂積", "athlete"),
    male("内山高志", "athlete"),
    male("具志堅用高", "athlete"),
    male("亀田興毅", "athlete"),
    male("亀田大毅", "athlete"),
    male("亀田和毅", "athlete"),
    male("辰吉丈一郎", "athlete"),
    male("井上拓真", "athlete"),
    male("寺地拳四朗", "athlete"),
    male("中谷潤人", "athlete"),
    male("比嘉大吾", "athlete"),
    male("京口紘人", "athlete"),
    male("平本蓮", "athlete"),
    male("武居由樹", "athlete"),
    male("秋山成勲", "athlete"),
    female("伊調馨", "athlete"),
    female("浜口京子", "athlete"),
    female("土性沙羅", "athlete"),
    female("登坂絵莉", "athlete"),
    female("角田夏実", "athlete"),
    female("新井千鶴", "athlete"),
    female("素根輝", "athlete"),
    female("志々目愛", "athlete"),
    female("濱田尚里", "athlete"),
    male("オカダ・カズチカ", "athlete"),
    male("内藤哲也", "athlete"),
    male("長州力", "athlete"),
    male("藤波辰爾", "athlete"),
    male("獣神サンダー・ライガー", "athlete"),
    male("小橋建太", "athlete"),
    male("三沢光晴", "athlete"),
    male("天龍源一郎", "athlete"),
    male("ジャイアント馬場", "athlete"),
    male("川田利明", "athlete"),
    male("高山善廣", "athlete"),
    male("永田裕志", "athlete"),
    male("真壁刀義", "athlete"),
    female("浅田真央", "athlete"),
    female("高橋尚子", "athlete"),
    female("野口みずき", "athlete"),
    female("有森裕子", "athlete"),
    female("北口榛花", "athlete"),
    female("田中希実", "athlete"),
    female("高木美帆", "athlete"),
    female("小平奈緒", "athlete"),
    female("荒川静香", "athlete"),
    female("坂本花織", "athlete"),
    female("本田真凜", "athlete"),
    female("宮原知子", "athlete"),
    female("安藤美姫", "athlete"),
    female("村上佳菜子", "athlete"),
    female("鈴木明子", "athlete"),
    female("平野美宇", "athlete"),
    female("早田ひな", "athlete"),
    female("渋野日向子", "athlete"),
    female("畑岡奈紗", "athlete"),
    female("宮里藍", "athlete"),
    female("寺川綾", "athlete"),
    female("星奈津美", "athlete"),
    female("高木菜那", "athlete"),
    male("白井健三", "athlete"),
    male("田臥勇太", "athlete"),
    male("富樫勇樹", "athlete"),
    male("河村勇輝", "athlete"),
    male("馬場雄大", "athlete"),
    male("比江島慎", "athlete"),
    male("丹羽孝希", "athlete"),
    male("水谷隼", "athlete"),
    male("入江陵介", "athlete"),
    male("松田丈志", "athlete"),
    male("小林陵侑", "athlete"),
    male("葛西紀明", "athlete"),
    male("船木和喜", "athlete"),
    male("白井空良", "athlete"),
]

CULTURAL_PEOPLE = [
    male("宮崎駿", "cultural"),
    male("是枝裕和", "cultural"),
    male("庵野秀明", "cultural"),
    male("北野武", "cultural"),
    male("秋元康", "cultural"),
    male("村上春樹", "cultural"),
    male("又吉直樹", "cultural"),
    male("小室哲哉", "cultural"),
    male("つんく", "cultural"),
    male("桑田佳祐", "cultural"),
    male("槇原敬之", "cultural"),
    male("秦基博", "cultural"),
    male("林修", "cultural"),
    male("マツコデラックス", "cultural"),
    male("池上彰", "cultural"),
    male("所ジョージ", "cultural"),
    male("タモリ", "cultural"),
    male("明石家さんま", "cultural"),
    male("笑福亭鶴瓶", "cultural"),
    male("島田紳助", "cultural"),
    male("志村けん", "cultural"),
    male("加藤茶", "cultural"),
    male("仲本工事", "cultural"),
    male("高木ブー", "cultural"),
    male("いかりや長介", "cultural"),
    male("萩本欽一", "cultural"),
    female("黒柳徹子", "cultural"),
    female("和田アキ子", "cultural"),
    female("デヴィ夫人", "cultural"),
    male("美輪明宏", "cultural"),
    male("坂本龍一", "cultural"),
    male("細田守", "cultural"),
    male("新海誠", "cultural"),
    male("三谷幸喜", "cultural"),
    male("宮藤官九郎", "cultural"),
    male("糸井重里", "cultural"),
    male("東野圭吾", "cultural"),
    female("湊かなえ", "cultural"),
    female("吉本ばなな", "cultural"),
    female("西加奈子", "cultural"),
    female("辻村深月", "cultural"),
    female("林真理子", "cultural"),
    female("阿川佐和子", "cultural"),
    female("有働由美子", "cultural"),
    male("古舘伊知郎", "cultural"),
    male("安住紳一郎", "cultural"),
    male("羽鳥慎一", "cultural"),
    male("田原総一朗", "cultural"),
    male("リリー・フランキー", "cultural"),
    male("鈴木敏夫", "cultural"),
    male("YOSHIKI", "cultural"),
    male("HYDE", "cultural"),
    male("GACKT", "cultural"),
    male("稲葉浩志", "cultural"),
    male("松本孝弘", "cultural"),
    male("小田和正", "cultural"),
    male("井上陽水", "cultural"),
    male("玉置浩二", "cultural"),
    male("布袋寅泰", "cultural"),
    male("さだまさし", "cultural"),
    male("吉井和哉", "cultural"),
    male("氷室京介", "cultural"),
    male("甲本ヒロト", "cultural"),
    male("真島昌利", "cultural"),
    male("藤井フミヤ", "cultural"),
    male("桜井和寿", "cultural"),
    male("草野マサムネ", "cultural"),
    male("山下達郎", "cultural"),
    male("佐野元春", "cultural"),
    male("矢沢永吉", "cultural"),
    male("長渕剛", "cultural"),
    male("忌野清志郎", "cultural"),
    female("中島みゆき", "cultural"),
    female("宇多田ヒカル", "cultural"),
    female("椎名林檎", "cultural"),
    female("松任谷由実", "cultural"),
    female("竹内まりや", "cultural"),
    female("aiko", "cultural"),
    female("越智志帆", "cultural"),
    female("吉田美和", "cultural"),
    female("絢香", "cultural"),
    female("一青窈", "cultural"),
]

PEOPLE = SUMO_PEOPLE + COMEDIAN_PEOPLE + ATHLETE_PEOPLE + CULTURAL_PEOPLE

DISCOVERY_SOURCES = [
    ("Category:日本の大相撲力士", "sumo", "male", 220),
    ("Category:日本のお笑い芸人", "comedian", "unknown", 220),
    ("Category:日本のサッカー選手", "athlete", "unknown", 220),
    ("Category:日本の野球選手", "athlete", "unknown", 220),
    ("Category:日本の柔道家", "athlete", "unknown", 120),
    ("Category:日本の総合格闘家", "athlete", "unknown", 120),
    ("Category:日本のボクサー", "athlete", "unknown", 120),
    ("Category:日本のプロレスラー", "athlete", "unknown", 120),
    ("Category:日本の映画監督", "cultural", "unknown", 120),
    ("Category:日本のミュージシャン", "cultural", "unknown", 220),
]

DISCOVERY_IGNORE = (
    "一覧",
    "テンプレート",
    "Template",
    "Portal",
    "プロジェクト",
    "Category:",
    "Wikipedia:",
    "Help:",
    "利用者:",
    "ファイル:",
    "画像",
    "曖昧さ回避",
    "大会",
    "選手権",
    "リーグ",
    "チーム",
    "クラブ",
    "日本代表",
    "全国",
    "歴代",
    "記録",
    "年表",
    "作品",
    "楽曲",
    "アルバム",
    "ディスコグラフィ",
    "コンビ",
    "トリオ",
    "グループ",
    "バンド",
    "ユニット",
    "番付",
    "相撲部屋",
)


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\\\|?*]', " ", name).strip().rstrip(".")
    return re.sub(r"\s+", " ", cleaned)


def unique_people(people: list[Person]) -> list[Person]:
    seen: set[str] = set()
    result: list[Person] = []
    for person in people:
        key = sanitize_filename(person.name)
        if key in seen:
            continue
        seen.add(key)
        result.append(person)
    return result


def should_use_discovered_title(title: str) -> bool:
    if not title:
        return False
    return not any(token in title for token in DISCOVERY_IGNORE)


def reference_names(person: Person) -> list[str]:
    refs: list[str] = []
    for value in (
        person.article,
        ARTICLE_OVERRIDES.get(person.name),
        person.name,
        *person.aliases,
        *EXTRA_ALIASES.get(person.name, ()),
    ):
        if value and value not in refs:
            refs.append(value)
    return refs


def normalize_title(text: str) -> str:
    normalized = re.sub(r'[\s・･"\'\(\)（）\[\]【】「」『』,，\.\-・]', "", text)
    normalized = normalized.replace("德", "徳").replace("櫻", "桜")
    return normalized


def is_reasonable_match(title: str, person: Person) -> bool:
    norm_title = normalize_title(title)
    if not norm_title:
        return False

    for ref in reference_names(person):
        norm_ref = normalize_title(ref)
        if not norm_ref:
            continue
        if norm_title == norm_ref:
            return True
        if len(norm_ref) >= 4 and norm_title.find(norm_ref) >= 0:
            return True
        if len(norm_ref) >= 4:
            ratio = difflib.SequenceMatcher(a=norm_title, b=norm_ref).ratio()
            if ratio >= 0.78:
                return True
    return False


def request_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def discover_people() -> list[Person]:
    discovered: list[Person] = []
    for category_title, category, gender, limit in DISCOVERY_SOURCES:
        collected = 0
        cmcontinue = None
        while collected < limit:
            params = {
                "action": "query",
                "list": "categorymembers",
                "cmtitle": category_title,
                "cmnamespace": "0",
                "cmtype": "page",
                "cmlimit": "500",
                "format": "json",
            }
            if cmcontinue:
                params["cmcontinue"] = cmcontinue

            url = f"https://ja.wikipedia.org/w/api.php?{urllib.parse.urlencode(params)}"
            try:
                data = request_json(url)
            except urllib.error.URLError as exc:
                print(f"[discover] {category_title}: failed ({exc})")
                break

            members = data.get("query", {}).get("categorymembers", [])
            for member in members:
                title = member.get("title", "")
                if not should_use_discovered_title(title):
                    continue
                discovered.append(Person(name=title, category=category, gender=gender, article=title))
                collected += 1
                if collected >= limit:
                    break

            cmcontinue = data.get("continue", {}).get("cmcontinue")
            if not cmcontinue:
                break

        print(f"[discover] {category_title}: {collected}")
    return discovered


def fetch_thumbnail(article: str) -> tuple[str | None, str | None]:
    params = {
        "action": "query",
        "titles": article,
        "prop": "pageimages",
        "pithumbsize": "800",
        "format": "json",
        "formatversion": "2",
        "redirects": "1",
    }
    url = f"https://ja.wikipedia.org/w/api.php?{urllib.parse.urlencode(params)}"
    data = request_json(url)
    pages = data.get("query", {}).get("pages", [])
    for page in pages:
        thumbnail = page.get("thumbnail", {})
        source = thumbnail.get("source")
        if source and ".svg" not in source.lower():
            return source, page.get("title")
    return None, None


def search_titles(person: Person) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()

    def add(title: str | None) -> None:
        if not title:
            return
        if title not in seen:
            titles.append(title)
            seen.add(title)

    for ref in reference_names(person):
        add(ref)
    for alias in person.aliases:
        add(alias)

    hints = SEARCH_HINTS.get(person.category, [])
    queries = [person.name]
    for hint in hints:
        queries.append(f"{person.name} {hint}")
    for alias in person.aliases:
        queries.append(alias)
        for hint in hints:
            queries.append(f"{alias} {hint}")

    for query in queries:
        params = {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": "5",
            "format": "json",
            "utf8": "1",
        }
        url = f"https://ja.wikipedia.org/w/api.php?{urllib.parse.urlencode(params)}"
        try:
            data = request_json(url)
        except Exception:
            continue
        for result in data.get("query", {}).get("search", []):
            title = result.get("title")
            if title and is_reasonable_match(title, person):
                add(title)

    return titles


def detect_extension(url: str, content_type: str | None) -> str:
    if content_type:
        lowered = content_type.lower()
        if "png" in lowered:
            return ".png"
        if "webp" in lowered:
            return ".webp"
        if "jpeg" in lowered or "jpg" in lowered:
            return ".jpg"
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".jpg"


def download_image(url: str, target_base: Path) -> Path:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
        ext = detect_extension(url, resp.headers.get("Content-Type"))
    output_path = target_base.with_suffix(ext)
    output_path.write_bytes(body)
    return output_path


def has_existing_directory(person: Person, existing_dirs: set[str]) -> str | None:
    candidates = [sanitize_filename(value) for value in reference_names(person)]
    for candidate in candidates:
        if candidate in existing_dirs:
            return candidate
    for candidate in candidates:
        for existing in existing_dirs:
            if candidate.startswith(existing) or existing.startswith(candidate):
                return existing
    return None


def write_metadata_files(person_dir: Path, person: Person) -> None:
    (person_dir / "category.txt").write_text(person.category, encoding="utf-8")
    (person_dir / "gender.txt").write_text(person.gender, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect celebrity images from Japanese Wikipedia article thumbnails.")
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds to sleep between networked items.")
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on successful downloads.")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    existing_dirs = {p.name for p in OUTPUT_DIR.iterdir() if p.is_dir()}
    manual_people = unique_people(PEOPLE)
    discovered_people = unique_people(discover_people())
    people = unique_people(manual_people + discovered_people)

    success = 0
    skipped = 0
    failed: list[dict[str, str]] = []

    print(f"Manual candidates: {len(manual_people)}")
    print(f"Discovered candidates: {len(discovered_people)}")
    print(f"Total candidates: {len(people)}")
    print(f"Existing dirs: {len(existing_dirs)}")

    for index, person in enumerate(people, start=1):
        if args.limit and success >= args.limit:
            break

        existing = has_existing_directory(person, existing_dirs)
        if existing:
            skipped += 1
            print(f"[skip {index}/{len(people)}] {person.name} -> existing {existing}")
            continue

        article_titles = search_titles(person)
        image_url = None
        used_title = None
        for title in article_titles:
            try:
                image_url, resolved_title = fetch_thumbnail(title)
            except Exception as exc:
                image_url = None
                resolved_title = None
                print(f"[warn {index}/{len(people)}] {person.name} API error: {exc}")
                continue
            if image_url:
                used_title = resolved_title or title
                if is_reasonable_match(used_title, person):
                    break
                image_url = None
                used_title = None

        if not image_url:
            print(f"[fail {index}/{len(people)}] {person.name} -> no thumbnail")
            failed.append({"name": person.name, "reason": "no_thumbnail"})
            time.sleep(args.sleep)
            continue

        dir_name = sanitize_filename(person.name)
        person_dir = OUTPUT_DIR / dir_name
        try:
            person_dir.mkdir(parents=True, exist_ok=False)
            download_path = download_image(image_url, person_dir / "photo")
            write_metadata_files(person_dir, person)
            success += 1
            existing_dirs.add(dir_name)
            print(f"[ok   {index}/{len(people)}] {person.name} <- {used_title} ({download_path.name})")
        except FileExistsError:
            skipped += 1
            print(f"[skip {index}/{len(people)}] {person.name} -> directory already created")
        except Exception as exc:
            if person_dir.exists():
                for child in person_dir.iterdir():
                    child.unlink()
                person_dir.rmdir()
            failed.append({"name": person.name, "reason": str(exc)})
            print(f"[fail {index}/{len(people)}] {person.name} -> {exc}")

        time.sleep(args.sleep)

    failure_path = SCRIPT_DIR / "collect_bulk_failures.json"
    failure_path.write_text(json.dumps(failed, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print(f"Downloaded: {success}")
    print(f"Skipped:    {skipped}")
    print(f"Failed:     {len(failed)}")
    print(f"Failures:   {failure_path}")


if __name__ == "__main__":
    main()
