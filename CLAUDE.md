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

68の顔ランドマークから5指標を計算:
- **黄金比 (35%):** 顔の縦横比・目の間隔 (理想値: 1.46)
- **輪郭 (20%):** 顎ラインの滑らかさ
- **目 (15%):** アスペクト比・左右バランス
- **鼻 (15%):** 幅/長さの比率
- **口 (15%):** 口幅/鼻幅比・唇の比率

オプション補正: 年齢補正 (23歳ピーク)、SNS影響力 (フォロワー数対数スケール)

## Conventions

- Git author: jim-auto
- vite base path: `/appearance-ranking-and-lookalike/`
- デプロイ: main push で自動 (GitHub Actions)
- 顔解析はすべてブラウザ内完結 (サーバーに画像送信なし)
- サムネイルは 200x200px
