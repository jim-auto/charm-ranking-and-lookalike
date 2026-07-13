# Face Ranking & Lookalike

日本の有名人の顔をランキング表示し、ユーザーの顔写真から似ている有名人を診断するWebアプリ。

本番URL: https://jim-auto.github.io/appearance-ranking-and-lookalike/

## Tech Stack

- **Frontend:** React 19 + TypeScript, Vite, Tailwind CSS 4, React Router, Chart.js
- **顔認識 (ブラウザ):** @vladmandic/face-api (TensorFlow.js)
- **データ処理 (オフライン):** Python 3 (dlib, face_recognition, OpenCV)
- **デプロイ:** GitHub Pages via GitHub Actions (Node 20)

## Project Structure

```
scripts/              # Python: 画像収集・顔解析・スコア計算
  input_images/       # 有名人の写真 + category.txt
  process_faces.py    # 68ランドマーク検出 & スコア算出
  generate_data.py    # celebrities.json + サムネイル生成
web/                  # React フロントエンド
  src/
    pages/            # RankingPage, DiagnosePage
    components/       # CelebrityCard, ScoreRadar, ImageUploader, etc.
    lib/              # faceDetection, faceScoring, embedding
    types/            # TypeScript 型定義
  public/
    data/             # celebrities.json, thumbnails/, embeddings.bin
    models/           # face-api.js MLモデル (~6MB)
```

## Development Commands

```bash
# フロントエンド開発
cd web && npm install
cd web && npm run dev          # 開発サーバー起動
cd web && npm run build        # 本番ビルド

# データ生成 (Python)
cd scripts && pip install -r requirements.txt
cd scripts && python generate_data.py
```

## Scoring Algorithm

68の顔ランドマークから各指標のraw score (0-100) を計算する。

**総合スコアに使う4指標** (各値を全体分布で偏差値化してから加重合成):
- **黄金比 (40%):** 顔の縦横比 (理想値 1.46) と目の間隔/顔幅 (理想値 1/1.618)
- **目 (20%):** アスペクト比 (理想値 0.33)・左右バランス
- **鼻 (20%):** 鼻幅/顔幅 (0.26)・鼻長/顔高 (0.33)
- **口 (20%):** 口幅/鼻幅 (1.5)・上下唇比 (0.8)

**表示のみの指標** (レーダーチャート用。総合スコアには不算入):
- **輪郭:** 顎ラインの形状・滑らかさ
- **左右対称性 (symmetry):** ロール補正後の左右ペア誤差

オプション補正: 年齢補正 (23歳ピーク)、SNS影響力 (フォロワー数対数スケール)

**Single source of truth:** 採点数式は `scripts/scoring.py` に集約。生成系
(`reprocess_all.py` = 本番, `process_faces*.py` = dev) はすべてこれをimportする。
ブラウザ診断側の `web/src/lib/faceMetricCalculator.ts` はこの数式を厳密にミラー
する必要がある (片方だけ変更すると診断値と有名人分布が比較不能になる)。
最終総合スコアの偏差値化は `scripts/metric_distribution.py` /
`web/src/lib/metricDistribution.ts`。

## Conventions

- Git author: jim-auto
- vite base path: `/appearance-ranking-and-lookalike/`
- デプロイ: main push で自動 (GitHub Actions)
- 顔解析はすべてブラウザ内完結 (サーバーに画像送信なし)
- サムネイルは 200x200px
