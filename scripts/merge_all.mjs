/**
 * Merge ALL celebrities from input_images/ into celebrities.json
 * Processes every person dir that has photo.jpg
 * Usage: node scripts/merge_all.mjs
 */

import * as faceapi from 'face-api.js';
import canvas from 'canvas';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODEL_DIR = path.join(__dirname, '..', 'web', 'public', 'models');
const INPUT_DIR = path.join(__dirname, 'input_images');
const OUTPUT_DIR = path.join(__dirname, '..', 'web', 'public', 'data');
const THUMB_DIR = path.join(OUTPUT_DIR, 'thumbnails');

function distance(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, v)); }
function ratioScore(actual, ideal) { return clamp((1 - Math.abs(actual - ideal) / ideal) * 100); }

// Check if face is roughly frontal using landmarks
// Returns { frontal: bool, yaw: number (-1=left, 1=right), pitch: number (negative=down) }
function checkFrontal(lm) {
  const noseTop = lm[27], noseTip = lm[30];
  const leftJaw = lm[0], rightJaw = lm[16];
  const fw = distance(leftJaw, rightJaw);
  const leftEye = midpoint(lm[36], lm[39]);
  const rightEye = midpoint(lm[42], lm[45]);

  // Yaw: nose tip position relative to face center
  const faceCenterX = (leftJaw.x + rightJaw.x) / 2;
  const noseOffsetX = (noseTip.x - faceCenterX) / fw; // -0.5 to 0.5

  // Also check eye width ratio (profile = one eye much smaller)
  const leftEyeW = distance(lm[36], lm[39]);
  const rightEyeW = distance(lm[42], lm[45]);
  const eyeRatio = Math.min(leftEyeW, rightEyeW) / Math.max(leftEyeW, rightEyeW);

  // Pitch: vertical nose angle
  const fh = distance(noseTop, lm[8]);
  const noseLen = distance(noseTop, noseTip);
  const pitchRatio = noseLen / fh; // small = looking down

  // Frontal criteria:
  // - nose not too far from center (|offset| < 0.25)
  // - both eyes roughly same width (ratio > 0.50) — profile makes one eye tiny
  const isFrontal = Math.abs(noseOffsetX) < 0.25 && eyeRatio > 0.50;

  return {
    frontal: isFrontal,
    yaw: noseOffsetX,
    eyeRatio: Math.round(eyeRatio * 100) / 100,
    pitchRatio: Math.round(pitchRatio * 100) / 100,
  };
}

function calcScore(lm) {
  const fw = distance(lm[0], lm[16]);
  const jl = lm.slice(0, 8), jr = lm.slice(9, 17).reverse(), nb = lm[27];
  let td = 0;
  const pairs = Math.min(jl.length, jr.length);
  for (let i = 0; i < pairs; i++) td += Math.abs(Math.abs(jl[i].x - nb.x) - Math.abs(jr[i].x - nb.x));
  const symmetry = clamp((1 - td / pairs / fw * 4) * 100);

  const fh = distance(lm[27], lm[8]) * 1.3;
  const le = midpoint(lm[36], lm[39]), re = midpoint(lm[42], lm[45]);
  const golden_ratio = (ratioScore(fh / fw, 1.46) + ratioScore(distance(le, re) / fw, 0.44)) / 2;

  const lw = distance(lm[36], lm[39]), lh = distance(lm[37], lm[41]);
  const rw = distance(lm[42], lm[45]), rh = distance(lm[43], lm[47]);
  const bal = 1 - Math.abs(lw - rw) / ((lw + rw) / 2);
  const eyes = clamp(ratioScore((lh / lw + rh / rw) / 2, 0.33) * 0.6 + bal * 100 * 0.4);

  const nose = (ratioScore(distance(lm[31], lm[35]) / fw, 0.26) + ratioScore(distance(lm[27], lm[30]) / fh, 0.33)) / 2;
  const mouth = (ratioScore(distance(lm[48], lm[54]) / distance(lm[31], lm[35]), 1.5) +
    ratioScore(distance(lm[51], lm[62]) / distance(lm[57], lm[66]), 0.8)) / 2;

  const jaw = lm.slice(0, 17);
  let s = 0;
  for (let i = 1; i < jaw.length - 1; i++) {
    const e = midpoint(jaw[i - 1], jaw[i + 1]);
    const d = distance(jaw[i], e);
    const l = distance(jaw[i - 1], jaw[i + 1]);
    s += l > 0 ? d / l : 0;
  }
  const contour = clamp((1 - s / (jaw.length - 2) * 8) * 100);

  const details = {
    symmetry: Math.round(symmetry), golden_ratio: Math.round(golden_ratio),
    eyes: Math.round(eyes), nose: Math.round(nose),
    mouth: Math.round(mouth), contour: Math.round(contour),
  };

  // Raw score returned; final scoring uses z-score normalization across all people
  return { details, score: 0 };
}

function ageAdj(base, age) {
  const peakAge = 23, diff = Math.abs(age - peakAge);
  let adj;
  if (diff <= 3) adj = 5 - diff;
  else if (diff <= 10) adj = -(diff - 3) * 0.8;
  else adj = -5.6 - (diff - 10) * 1.2;
  return Math.round((base + adj) * 10) / 10;
}

function snsBonus(totalFollowers) {
  if (totalFollowers <= 0) return 0;
  return Math.round(Math.log10(totalFollowers) * 2 * 10) / 10;
}

function calcScoreSet(faceScore, age, totalFollowers) {
  const face = faceScore;
  const faceAge = ageAdj(face, age);
  const bonus = snsBonus(totalFollowers);
  const faceSns = Math.round((face * 0.7 + (face + bonus) * 0.3) * 10) / 10;
  const faceAgeSns = Math.round((faceAge * 0.7 + (faceAge + bonus) * 0.3) * 10) / 10;
  return { face, faceAge, faceSns, faceAgeSns };
}

// Metadata for all celebrities (name -> { age, gender, sns, totalFollowers })
// Ages as of 2026
const META = {
  // 女優
  'SANA(TWICE)': { age: 29, gender: 'female', sns: { instagram: 15000000, twitter: 0, tiktok: 5000000, youtube: 2700000 }, totalFollowers: 22700000 },
  '橋本環奈': { age: 27, gender: 'female', sns: { instagram: 7500000, twitter: 2800000 }, totalFollowers: 10300000 },
  '長澤まさみ': { age: 39, gender: 'female', sns: { instagram: 1200000 }, totalFollowers: 1200000 },
  '綾瀬はるか': { age: 41, gender: 'female', sns: { instagram: 800000 }, totalFollowers: 800000 },
  '浜辺美波': { age: 24, gender: 'female', sns: { instagram: 6500000, twitter: 2700000 }, totalFollowers: 9200000 },
  '広瀬すず': { age: 28, gender: 'female', sns: { instagram: 4500000, twitter: 1400000 }, totalFollowers: 5900000 },
  '新垣結衣': { age: 38, gender: 'female', sns: { instagram: 1500000 }, totalFollowers: 1500000 },
  '齋藤飛鳥': { age: 28, gender: 'female', sns: { instagram: 3500000, twitter: 3000000 }, totalFollowers: 6500000 },
  '芦田愛菜': { age: 21, gender: 'female', sns: {}, totalFollowers: 0 },
  '清原果耶': { age: 23, gender: 'female', sns: { instagram: 1200000 }, totalFollowers: 1200000 },
  '上白石萌歌': { age: 26, gender: 'female', sns: { instagram: 800000, twitter: 300000 }, totalFollowers: 1100000 },
  '南沙良': { age: 23, gender: 'female', sns: { instagram: 500000 }, totalFollowers: 500000 },
  'Koki': { age: 22, gender: 'female', sns: { instagram: 7800000, tiktok: 2000000, youtube: 500000 }, totalFollowers: 10300000 },
  '与田祐希': { age: 25, gender: 'female', sns: {}, totalFollowers: 0 },
  '石原さとみ': { age: 39, gender: 'female', sns: { instagram: 3000000 }, totalFollowers: 3000000 },
  '北川景子': { age: 39, gender: 'female', sns: { instagram: 4200000 }, totalFollowers: 4200000 },
  '有村架純': { age: 33, gender: 'female', sns: { instagram: 3500000, twitter: 2000000 }, totalFollowers: 5500000 },
  '今田美桜': { age: 29, gender: 'female', sns: { instagram: 5000000, twitter: 1500000 }, totalFollowers: 6500000 },
  '吉高由里子': { age: 36, gender: 'female', sns: { instagram: 1800000 }, totalFollowers: 1800000 },
  '川口春奈': { age: 30, gender: 'female', sns: { instagram: 3800000, youtube: 1500000 }, totalFollowers: 5300000 },
  '本田翼': { age: 34, gender: 'female', sns: { instagram: 4500000, youtube: 2200000 }, totalFollowers: 6700000 },
  '深田恭子': { age: 43, gender: 'female', sns: { instagram: 3200000 }, totalFollowers: 3200000 },
  '桐谷美玲': { age: 36, gender: 'female', sns: { instagram: 3000000 }, totalFollowers: 3000000 },
  '佐々木希': { age: 38, gender: 'female', sns: { instagram: 6500000 }, totalFollowers: 6500000 },
  '土屋太鳳': { age: 31, gender: 'female', sns: { instagram: 2500000, twitter: 1500000 }, totalFollowers: 4000000 },
  '杉咲花': { age: 28, gender: 'female', sns: { instagram: 1200000 }, totalFollowers: 1200000 },
  '上白石萌音': { age: 28, gender: 'female', sns: { instagram: 1000000 }, totalFollowers: 1000000 },
  '松本まりか': { age: 42, gender: 'female', sns: { instagram: 1500000, twitter: 600000 }, totalFollowers: 2100000 },
  '池田エライザ': { age: 30, gender: 'female', sns: { instagram: 2500000, twitter: 1200000 }, totalFollowers: 3700000 },
  '広瀬アリス': { age: 30, gender: 'female', sns: { instagram: 2000000, twitter: 1500000 }, totalFollowers: 3500000 },
  '森川葵': { age: 31, gender: 'female', sns: { instagram: 800000 }, totalFollowers: 800000 },
  '黒木華': { age: 36, gender: 'female', sns: {}, totalFollowers: 0 },
  '吉岡里帆': { age: 33, gender: 'female', sns: { instagram: 3000000, twitter: 1000000 }, totalFollowers: 4000000 },
  '松岡茉優': { age: 31, gender: 'female', sns: { instagram: 1000000 }, totalFollowers: 1000000 },
  '飯豊まりえ': { age: 28, gender: 'female', sns: { instagram: 1200000 }, totalFollowers: 1200000 },
  '奈緒': { age: 31, gender: 'female', sns: { instagram: 700000 }, totalFollowers: 700000 },
  '山本舞香': { age: 28, gender: 'female', sns: { instagram: 600000, twitter: 300000 }, totalFollowers: 900000 },
  '小松菜奈': { age: 30, gender: 'female', sns: { instagram: 5000000 }, totalFollowers: 5000000 },
  '二階堂ふみ': { age: 31, gender: 'female', sns: { instagram: 1500000 }, totalFollowers: 1500000 },
  '高畑充希': { age: 34, gender: 'female', sns: { instagram: 1800000, twitter: 800000 }, totalFollowers: 2600000 },
  '森七菜': { age: 24, gender: 'female', sns: { instagram: 1500000 }, totalFollowers: 1500000 },
  '永野芽郁': { age: 26, gender: 'female', sns: { instagram: 3500000, twitter: 1000000 }, totalFollowers: 4500000 },
  '福原遥': { age: 28, gender: 'female', sns: { instagram: 1500000, twitter: 800000, youtube: 500000 }, totalFollowers: 2800000 },
  '山田杏奈': { age: 24, gender: 'female', sns: { instagram: 300000 }, totalFollowers: 300000 },

  // 俳優
  '佐藤健': { age: 37, gender: 'male', sns: { instagram: 5000000, twitter: 3000000, youtube: 3500000 }, totalFollowers: 11500000 },
  '山崎賢人': { age: 32, gender: 'male', sns: { instagram: 4500000, twitter: 1300000 }, totalFollowers: 5800000 },
  '菅田将暉': { age: 33, gender: 'male', sns: { instagram: 5000000, twitter: 2500000 }, totalFollowers: 7500000 },
  '横浜流星': { age: 30, gender: 'male', sns: { instagram: 4000000, twitter: 1500000 }, totalFollowers: 5500000 },
  '吉沢亮': { age: 32, gender: 'male', sns: { instagram: 2500000 }, totalFollowers: 2500000 },
  '新田真剣佑': { age: 30, gender: 'male', sns: { instagram: 5000000 }, totalFollowers: 5000000 },
  '竹内涼真': { age: 33, gender: 'male', sns: { instagram: 3200000, twitter: 1000000 }, totalFollowers: 4200000 },
  '福士蒼汰': { age: 33, gender: 'male', sns: { instagram: 2800000 }, totalFollowers: 2800000 },
  '中村倫也': { age: 39, gender: 'male', sns: { instagram: 2000000, twitter: 1000000 }, totalFollowers: 3000000 },
  '岡田准一': { age: 45, gender: 'male', sns: {}, totalFollowers: 0 },
  '松坂桃李': { age: 38, gender: 'male', sns: {}, totalFollowers: 0 },
  '田中圭': { age: 42, gender: 'male', sns: { instagram: 2000000 }, totalFollowers: 2000000 },
  '玉木宏': { age: 46, gender: 'male', sns: {}, totalFollowers: 0 },
  '三浦翔平': { age: 38, gender: 'male', sns: { instagram: 1500000 }, totalFollowers: 1500000 },
  '千葉雄大': { age: 37, gender: 'male', sns: { instagram: 1200000, twitter: 600000 }, totalFollowers: 1800000 },
  // '瀬戸康史': removed — no solo photo available on Wikimedia (only 瀬戸弘司)
  '岩田剛典': { age: 37, gender: 'male', sns: { instagram: 2500000, twitter: 1000000 }, totalFollowers: 3500000 },
  '間宮祥太朗': { age: 33, gender: 'male', sns: { instagram: 1500000 }, totalFollowers: 1500000 },
  '磯村勇斗': { age: 33, gender: 'male', sns: { instagram: 800000 }, totalFollowers: 800000 },
  '高橋文哉': { age: 24, gender: 'male', sns: { instagram: 1500000, twitter: 500000 }, totalFollowers: 2000000 },
  '赤楚衛二': { age: 32, gender: 'male', sns: { instagram: 1200000 }, totalFollowers: 1200000 },
  '眞栄田郷敦': { age: 26, gender: 'male', sns: { instagram: 800000 }, totalFollowers: 800000 },
  '神木隆之介': { age: 33, gender: 'male', sns: { instagram: 1500000, twitter: 1000000 }, totalFollowers: 2500000 },
  '坂口健太郎': { age: 35, gender: 'male', sns: { instagram: 3000000 }, totalFollowers: 3000000 },
  '中川大志': { age: 28, gender: 'male', sns: { instagram: 800000, twitter: 500000 }, totalFollowers: 1300000 },
  '北村匠海': { age: 28, gender: 'male', sns: { instagram: 1500000, twitter: 800000 }, totalFollowers: 2300000 },

  // アイドル
  '道枝駿佑': { age: 23, gender: 'male', sns: {}, totalFollowers: 0 },
  'MOMO(TWICE)': { age: 29, gender: 'female', sns: { instagram: 14000000 }, totalFollowers: 14000000 },
  '平野紫耀': { age: 29, gender: 'male', sns: { instagram: 3500000 }, totalFollowers: 3500000 },
  '髙橋海人': { age: 27, gender: 'male', sns: {}, totalFollowers: 0 },
  '永瀬廉': { age: 27, gender: 'male', sns: {}, totalFollowers: 0 },
  '岸優太': { age: 30, gender: 'male', sns: {}, totalFollowers: 0 },
  '松村北斗': { age: 30, gender: 'male', sns: {}, totalFollowers: 0 },
  '渡辺翔太': { age: 34, gender: 'male', sns: {}, totalFollowers: 0 },
  'ラウール': { age: 22, gender: 'male', sns: {}, totalFollowers: 0 },
  '目黒蓮': { age: 29, gender: 'male', sns: {}, totalFollowers: 0 },
  '賀喜遥香': { age: 25, gender: 'female', sns: {}, totalFollowers: 0 },
  '遠藤さくら': { age: 24, gender: 'female', sns: {}, totalFollowers: 0 },
  '山下美月': { age: 27, gender: 'female', sns: { instagram: 1500000 }, totalFollowers: 1500000 },
  '生田絵梨花': { age: 29, gender: 'female', sns: { instagram: 2000000, youtube: 800000 }, totalFollowers: 2800000 },
  '白石麻衣': { age: 34, gender: 'female', sns: { instagram: 3500000, youtube: 1200000 }, totalFollowers: 4700000 },
  '西野七瀬': { age: 32, gender: 'female', sns: { instagram: 2500000 }, totalFollowers: 2500000 },
  '指原莉乃': { age: 33, gender: 'female', sns: { twitter: 3000000, youtube: 1500000 }, totalFollowers: 4500000 },

  // イコラブ
  '齊藤なぎさ': { age: 23, gender: 'female', sns: { twitter: 200000 }, totalFollowers: 200000 },
  '野口衣織': { age: 24, gender: 'female', sns: { twitter: 150000 }, totalFollowers: 150000 },
  '大谷映美里': { age: 29, gender: 'female', sns: { twitter: 200000 }, totalFollowers: 200000 },
  '佐々木舞香': { age: 25, gender: 'female', sns: { twitter: 150000 }, totalFollowers: 150000 },
  '髙松瞳': { age: 28, gender: 'female', sns: { twitter: 150000 }, totalFollowers: 150000 },

  // ノイミー (≠ME)
  '鈴木瞳美': { age: 22, gender: 'female', sns: { twitter: 100000 }, totalFollowers: 100000 },
  '谷崎早耶': { age: 22, gender: 'female', sns: { twitter: 80000 }, totalFollowers: 80000 },
  '尾木波菜': { age: 21, gender: 'female', sns: { twitter: 80000 }, totalFollowers: 80000 },
  '冨田菜々風': { age: 23, gender: 'female', sns: { twitter: 100000 }, totalFollowers: 100000 },
  '蟹沢萌子': { age: 25, gender: 'female', sns: { twitter: 120000 }, totalFollowers: 120000 },
  '河口夏音': { age: 22, gender: 'female', sns: { twitter: 80000 }, totalFollowers: 80000 },
  '櫻井もも': { age: 21, gender: 'female', sns: { twitter: 80000 }, totalFollowers: 80000 },

  // 日向坂46
  '小坂菜緒': { age: 24, gender: 'female', sns: {}, totalFollowers: 0 },
  '金村美玖': { age: 24, gender: 'female', sns: {}, totalFollowers: 0 },
  '加藤史帆': { age: 28, gender: 'female', sns: {}, totalFollowers: 0 },

  // その他
  '橋本奈々未': { age: 33, gender: 'female', sns: {}, totalFollowers: 0 },
  '松田好花': { age: 25, gender: 'female', sns: {}, totalFollowers: 0 },
  '田中美久': { age: 24, gender: 'female', sns: { instagram: 500000, twitter: 400000 }, totalFollowers: 900000 },
  '本田仁美': { age: 24, gender: 'female', sns: { instagram: 500000, twitter: 300000 }, totalFollowers: 800000 },

  // インフルエンサー
  'はじめしゃちょー': { age: 33, gender: 'male', sns: { youtube: 10000000, twitter: 5200000, instagram: 3000000, tiktok: 5500000 }, totalFollowers: 23700000 },
  'HIKAKIN': { age: 37, gender: 'male', sns: { youtube: 11000000, twitter: 5000000, instagram: 3000000, tiktok: 4000000 }, totalFollowers: 23000000 },
  '藤田ニコル': { age: 28, gender: 'female', sns: { instagram: 3000000, twitter: 2000000, youtube: 500000 }, totalFollowers: 5500000 },
  'りゅうちぇる': { age: 30, gender: 'male', sns: { instagram: 1000000, twitter: 500000 }, totalFollowers: 1500000 },
  'kemio': { age: 31, gender: 'male', sns: { youtube: 2000000, instagram: 1500000, twitter: 500000 }, totalFollowers: 4000000 },
  'ゆうこす': { age: 32, gender: 'female', sns: { instagram: 500000, youtube: 300000 }, totalFollowers: 800000 },
  'ローラ': { age: 36, gender: 'female', sns: { instagram: 7500000, twitter: 3500000 }, totalFollowers: 11000000 },
  'みちょぱ': { age: 28, gender: 'female', sns: { instagram: 2000000, twitter: 1200000 }, totalFollowers: 3200000 },
  '越智ゆらの': { age: 24, gender: 'female', sns: { instagram: 200000 }, totalFollowers: 200000 },

  // アーティスト
  '幾田りら': { age: 25, gender: 'female', sns: { instagram: 2000000, twitter: 1500000, youtube: 800000 }, totalFollowers: 4300000 },
  'あいみょん': { age: 31, gender: 'female', sns: { instagram: 2500000, twitter: 2000000, youtube: 1500000 }, totalFollowers: 6000000 },
  '大森元貴': { age: 28, gender: 'male', sns: { instagram: 1000000, twitter: 800000 }, totalFollowers: 1800000 },
  '優里': { age: 30, gender: 'male', sns: { instagram: 1500000, twitter: 800000, youtube: 2000000, tiktok: 1500000 }, totalFollowers: 5800000 },
  'Ado': { age: 24, gender: 'female', sns: { youtube: 5000000, twitter: 3000000 }, totalFollowers: 8000000 },
  '米津玄師': { age: 35, gender: 'male', sns: { youtube: 5000000, twitter: 4000000, instagram: 2000000 }, totalFollowers: 11000000 },
  '藤井風': { age: 28, gender: 'male', sns: { youtube: 3000000, instagram: 2500000, twitter: 1000000 }, totalFollowers: 6500000 },
  'LISA': { age: 39, gender: 'female', sns: { instagram: 3500000, twitter: 3000000, youtube: 2000000 }, totalFollowers: 8500000 },
  'Aimer': { age: 36, gender: 'female', sns: { youtube: 1500000, twitter: 800000 }, totalFollowers: 2300000 },
  'Official髭男dism藤原聡': { age: 35, gender: 'male', sns: {}, totalFollowers: 0 },
  'King Gnu井口理': { age: 33, gender: 'male', sns: { instagram: 500000 }, totalFollowers: 500000 },
  'back number清水依与吏': { age: 38, gender: 'male', sns: {}, totalFollowers: 0 },

  // イコラブ追加
  '音嶋莉沙': { age: 22, gender: 'female', sns: { twitter: 100000 }, totalFollowers: 100000 },
  '瀧脇笙古': { age: 25, gender: 'female', sns: { twitter: 100000 }, totalFollowers: 100000 },

  // アーティスト追加
  '星野源': { age: 45, gender: 'male', sns: { instagram: 3000000, twitter: 3500000, youtube: 1500000 }, totalFollowers: 8000000 },
  'YUKI': { age: 54, gender: 'female', sns: {}, totalFollowers: 0 },
  '椎名林檎': { age: 48, gender: 'female', sns: {}, totalFollowers: 0 },
  '宇多田ヒカル': { age: 43, gender: 'female', sns: { instagram: 3500000, twitter: 4000000 }, totalFollowers: 7500000 },
  '三浦大知': { age: 38, gender: 'male', sns: { instagram: 800000, twitter: 600000, youtube: 500000 }, totalFollowers: 1900000 },
  'Vaundy': { age: 26, gender: 'male', sns: { instagram: 1000000, youtube: 2000000 }, totalFollowers: 3000000 },
  'MISIA': { age: 48, gender: 'female', sns: { instagram: 500000 }, totalFollowers: 500000 },
  'JUJU': { age: 50, gender: 'female', sns: { instagram: 300000 }, totalFollowers: 300000 },
  'Nissy西島隆弘': { age: 38, gender: 'male', sns: { instagram: 2500000, youtube: 1000000 }, totalFollowers: 3500000 },
  'きゃりーぱみゅぱみゅ': { age: 33, gender: 'female', sns: { instagram: 5500000, twitter: 5000000 }, totalFollowers: 10500000 },
  'miwa': { age: 36, gender: 'female', sns: { instagram: 500000, twitter: 800000 }, totalFollowers: 1300000 },
  '家入レオ': { age: 32, gender: 'female', sns: { instagram: 300000, twitter: 400000 }, totalFollowers: 700000 },

  // インフルエンサー追加
  '渡辺直美': { age: 38, gender: 'female', sns: { instagram: 9500000, youtube: 1500000, twitter: 2000000 }, totalFollowers: 13000000 },
  'フワちゃん': { age: 31, gender: 'female', sns: { instagram: 1500000, twitter: 1000000, youtube: 1200000 }, totalFollowers: 3700000 },
  'コムドット やまと': { age: 28, gender: 'male', sns: { youtube: 4000000, instagram: 2000000 }, totalFollowers: 6000000 },
  '東海オンエア てつや': { age: 33, gender: 'male', sns: { youtube: 7000000, twitter: 2000000 }, totalFollowers: 9000000 },
  '水溜りボンド カンタ': { age: 32, gender: 'male', sns: { youtube: 4000000 }, totalFollowers: 4000000 },
  'ヒカル': { age: 33, gender: 'male', sns: { youtube: 5000000, twitter: 2000000, instagram: 1500000 }, totalFollowers: 8500000 },
  '朝倉未来': { age: 33, gender: 'male', sns: { youtube: 4000000, instagram: 2000000, twitter: 1500000 }, totalFollowers: 7500000 },
  '朝倉海': { age: 32, gender: 'male', sns: { youtube: 2500000, instagram: 1500000 }, totalFollowers: 4000000 },

  // 俳優追加
  '窪田正孝': { age: 37, gender: 'male', sns: { instagram: 1500000 }, totalFollowers: 1500000 },
  '岡田将生': { age: 37, gender: 'male', sns: {}, totalFollowers: 0 },
  '三浦春馬': { age: 30, gender: 'male', sns: {}, totalFollowers: 0 },
  '福山雅治': { age: 57, gender: 'male', sns: { instagram: 2000000, twitter: 1500000 }, totalFollowers: 3500000 },
  '木村拓哉': { age: 53, gender: 'male', sns: { instagram: 4000000, youtube: 2000000 }, totalFollowers: 6000000 },
  '妻夫木聡': { age: 45, gender: 'male', sns: {}, totalFollowers: 0 },
  '小栗旬': { age: 43, gender: 'male', sns: { instagram: 2000000 }, totalFollowers: 2000000 },
  '藤原竜也': { age: 44, gender: 'male', sns: {}, totalFollowers: 0 },
  '長瀬智也': { age: 47, gender: 'male', sns: {}, totalFollowers: 0 },

  // 女優追加
  '石田ゆり子': { age: 57, gender: 'female', sns: { instagram: 4500000 }, totalFollowers: 4500000 },
  '天海祐希': { age: 58, gender: 'female', sns: {}, totalFollowers: 0 },
  '仲間由紀恵': { age: 46, gender: 'female', sns: {}, totalFollowers: 0 },
  '宮崎あおい': { age: 41, gender: 'female', sns: {}, totalFollowers: 0 },
  '蒼井優': { age: 40, gender: 'female', sns: {}, totalFollowers: 0 },
  '多部未華子': { age: 37, gender: 'female', sns: {}, totalFollowers: 0 },
  '戸田恵梨香': { age: 38, gender: 'female', sns: { instagram: 2000000 }, totalFollowers: 2000000 },
  '満島ひかり': { age: 40, gender: 'female', sns: {}, totalFollowers: 0 },
  '鬼頭明里': { age: 31, gender: 'female', sns: { twitter: 800000, youtube: 300000 }, totalFollowers: 1100000 },

  // アイドル追加
  '松井珠理奈': { age: 29, gender: 'female', sns: { instagram: 500000, twitter: 1000000 }, totalFollowers: 1500000 },
  '宮脇咲良': { age: 28, gender: 'female', sns: { instagram: 5000000, twitter: 2000000 }, totalFollowers: 7000000 },
  '渡邉理佐': { age: 28, gender: 'female', sns: { instagram: 800000 }, totalFollowers: 800000 },
  '菅井友香': { age: 30, gender: 'female', sns: { instagram: 500000 }, totalFollowers: 500000 },
  '佐藤勝利': { age: 30, gender: 'male', sns: {}, totalFollowers: 0 },
  '中島健人': { age: 31, gender: 'male', sns: { instagram: 2000000 }, totalFollowers: 2000000 },
  'King Prince神宮寺勇太': { age: 28, gender: 'male', sns: {}, totalFollowers: 0 },
  '向井康二': { age: 30, gender: 'male', sns: {}, totalFollowers: 0 },
  '阿部亮平': { age: 33, gender: 'male', sns: {}, totalFollowers: 0 },
  '大園玲': { age: 23, gender: 'female', sns: {}, totalFollowers: 0 },
  '藤吉夏鈴': { age: 23, gender: 'female', sns: {}, totalFollowers: 0 },
  '森田ひかる': { age: 23, gender: 'female', sns: {}, totalFollowers: 0 },
  '上村ひなの': { age: 21, gender: 'female', sns: {}, totalFollowers: 0 },
  '丹生明里': { age: 24, gender: 'female', sns: {}, totalFollowers: 0 },

  // FRUITS ZIPPER
  '月足天音': { age: 24, gender: 'female', sns: { instagram: 300000, tiktok: 500000 }, totalFollowers: 800000 },
  '鉢嶺杏奈': { age: 24, gender: 'female', sns: { instagram: 200000, tiktok: 300000 }, totalFollowers: 500000 },
  '仲川瑠夏': { age: 24, gender: 'female', sns: { instagram: 200000, tiktok: 400000 }, totalFollowers: 600000 },
  '松本かれん': { age: 24, gender: 'female', sns: { instagram: 200000 }, totalFollowers: 200000 },
  '真中まな': { age: 21, gender: 'female', sns: { instagram: 200000, tiktok: 300000 }, totalFollowers: 500000 },
  '早瀬ノエル': { age: 22, gender: 'female', sns: { instagram: 200000 }, totalFollowers: 200000 },
  '櫻井優衣': { age: 24, gender: 'female', sns: { instagram: 200000 }, totalFollowers: 200000 },

  // CANDY TUNE
  '堀内まり菜': { age: 25, gender: 'female', sns: { instagram: 100000 }, totalFollowers: 100000 },
  '蒔田真望': { age: 20, gender: 'female', sns: { instagram: 50000 }, totalFollowers: 50000 },
  '秋山美旺': { age: 19, gender: 'female', sns: { instagram: 50000 }, totalFollowers: 50000 },
  '清水唯菜': { age: 20, gender: 'female', sns: { instagram: 50000 }, totalFollowers: 50000 },
  '浅香鈴花': { age: 19, gender: 'female', sns: { instagram: 50000 }, totalFollowers: 50000 },
  '白濱優凪': { age: 20, gender: 'female', sns: { instagram: 50000 }, totalFollowers: 50000 },
  '佐藤ゆきな': { age: 21, gender: 'female', sns: { instagram: 50000 }, totalFollowers: 50000 },
};

// Group name mapping
const GROUPS = {
  'SANA(TWICE)': 'TWICE', 'MOMO(TWICE)': 'TWICE',
  '白石麻衣': '乃木坂46', '齋藤飛鳥': '乃木坂46', '与田祐希': '乃木坂46',
  '賀喜遥香': '乃木坂46', '遠藤さくら': '乃木坂46', '山下美月': '乃木坂46',
  '生田絵梨花': '乃木坂46', '西野七瀬': '乃木坂46', '橋本奈々未': '乃木坂46',
  'ラウール': 'Snow Man', '渡辺翔太': 'Snow Man', '目黒蓮': 'Snow Man',
  '道枝駿佑': 'なにわ男子', '松村北斗': 'SixTONES',
  '指原莉乃': 'HKT48', '田中美久': 'HKT48',
  '加藤史帆': '日向坂46', '松田好花': '日向坂46', '金村美玖': '日向坂46', '小坂菜緒': '日向坂46',
  '大谷映美里': '=LOVE', '齊藤なぎさ': '=LOVE', '野口衣織': '=LOVE',
  '佐々木舞香': '=LOVE', '髙松瞳': '=LOVE', '音嶋莉沙': '=LOVE', '瀧脇笙古': '=LOVE',
  '冨田菜々風': '≠ME', '蟹沢萌子': '≠ME', '鈴木瞳美': '≠ME',
  '櫻井もも': '≠ME', '谷崎早耶': '≠ME', '河口夏音': '≠ME', '尾木波菜': '≠ME',
  '平野紫耀': 'Number_i', '髙橋海人': 'King & Prince', '永瀬廉': 'King & Prince', '岸優太': 'Number_i',
  '本田仁美': 'AKB48',
  '幾田りら': 'YOASOBI', '大森元貴': 'Mrs. GREEN APPLE',
  'Official髭男dism藤原聡': 'Official髭男dism', 'King Gnu井口理': 'King Gnu',
  'back number清水依与吏': 'back number', 'LISA': 'LiSA',
  '星野源': 'シンガーソングライター', 'Nissy西島隆弘': 'AAA',
  '松井珠理奈': 'SKE48', '宮脇咲良': 'LE SSERAFIM',
  '渡邉理佐': '欅坂46', '菅井友香': '櫻坂46',
  '佐藤勝利': 'timelesz', '中島健人': 'timelesz',
  'King Prince神宮寺勇太': 'King & Prince',
  '向井康二': 'Snow Man', '阿部亮平': 'Snow Man',
  '大園玲': '櫻坂46', '藤吉夏鈴': '櫻坂46', '森田ひかる': '櫻坂46',
  '上村ひなの': '日向坂46', '丹生明里': '日向坂46',
  '月足天音': 'FRUITS ZIPPER', '鉢嶺杏奈': 'FRUITS ZIPPER',
  '仲川瑠夏': 'FRUITS ZIPPER', '松本かれん': 'FRUITS ZIPPER',
  '真中まな': 'FRUITS ZIPPER', '早瀬ノエル': 'FRUITS ZIPPER', '櫻井優衣': 'FRUITS ZIPPER',
  '堀内まり菜': 'CANDY TUNE', '蒔田真望': 'CANDY TUNE',
  '秋山美旺': 'CANDY TUNE', '清水唯菜': 'CANDY TUNE',
  '浅香鈴花': 'CANDY TUNE', '白濱優凪': 'CANDY TUNE', '佐藤ゆきな': 'CANDY TUNE',
};

async function main() {
  console.log('Loading models...');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
  console.log('Models loaded.\n');

  // Read all person directories
  const dirs = fs.readdirSync(INPUT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const all = [];
  let processed = 0, skipped = 0;

  for (const name of dirs) {
    const imgPath = path.join(INPUT_DIR, name, 'photo.jpg');
    const catPath = path.join(INPUT_DIR, name, 'category.txt');

    if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size < 1000) {
      console.log(`[skip] ${name} - no valid photo`);
      skipped++;
      continue;
    }

    const category = fs.existsSync(catPath) ? fs.readFileSync(catPath, 'utf-8').trim() : 'actor';
    const meta = META[name] || { age: 25, gender: category === 'actress' || category === 'idol' ? 'female' : 'male', sns: {}, totalFollowers: 0 };

    console.log(`[${processed + 1}] ${name} ...`);
    try {
      const buf = fs.readFileSync(imgPath);
      const img = await canvas.loadImage(buf);
      const cvs = canvas.createCanvas(img.width, img.height);
      cvs.getContext('2d').drawImage(img, 0, 0);

      const allDets = await faceapi.detectAllFaces(cvs).withFaceLandmarks().withFaceDescriptors();
      if (!allDets.length) {
        console.log(`  No face detected - skipping`);
        skipped++;
        continue;
      }

      // Pick best face: frontal + largest bounding box
      let bestDet = null, bestSize = 0, bestLm = null, bestFrontal = null;
      for (const det of allDets) {
        const lm = det.landmarks.positions.map(pt => ({ x: pt.x, y: pt.y }));
        const frontal = checkFrontal(lm);
        if (!frontal.frontal) continue;
        const box = det.detection.box;
        const size = box.width * box.height;
        if (size > bestSize) {
          bestDet = det;
          bestSize = size;
          bestLm = lm;
          bestFrontal = frontal;
        }
      }

      if (!bestDet) {
        // No frontal face found among all detections
        const lm0 = allDets[0].landmarks.positions.map(pt => ({ x: pt.x, y: pt.y }));
        const f0 = checkFrontal(lm0);
        console.log(`  ⚠ NOT FRONTAL (${allDets.length} faces, none frontal): yaw=${f0.yaw.toFixed(2)} eyeRatio=${f0.eyeRatio} - SKIPPING ${name}`);
        skipped++;
        continue;
      }

      if (allDets.length > 1) {
        console.log(`  ${allDets.length} faces detected, picked largest frontal face`);
      }

      const lm = bestLm;
      const embedding = Array.from(bestDet.descriptor);
      const { details, score } = calcScore(lm);
      const scores = calcScoreSet(score, meta.age, meta.totalFollowers);

      const entry = {
        name,
        category,
        age: meta.age,
        gender: meta.gender,
        score,
        scoreWithAge: scores.faceAge,
        scoreCharm: scores.faceSns,
        scores,
        sns: meta.sns,
        totalFollowers: meta.totalFollowers,
        details,
        embedding,
        thumbnail: '',
        _imgPath: imgPath,
        _det: bestDet,
      };
      if (GROUPS[name]) entry.group = GROUPS[name];
      all.push(entry);

      console.log(`  raw sym=${details.symmetry} golden=${details.golden_ratio} eyes=${details.eyes} nose=${details.nose} mouth=${details.mouth} cont=${details.contour}`);
      processed++;
    } catch (e) {
      console.log(`  Error: ${e.message}`);
      skipped++;
    }
  }

  // === Z-score normalization across all people ===
  const METRICS = ['symmetry', 'golden_ratio', 'eyes', 'nose', 'mouth', 'contour'];
  const WEIGHTS = {
    symmetry: 0.05,      // photo-dependent + glasses inflate this
    golden_ratio: 0.30,  // structural, stable across photos
    eyes: 0.15,          // proportional, moderately stable
    nose: 0.20,          // proportional, stable — increased weight
    mouth: 0.15,         // proportional, stable
    contour: 0.15,       // structural
  };

  // Step 1: Fix symmetry=0 (detection failure) with median of valid values
  const validSym = all.map(c => c.details.symmetry).filter(v => v > 0).sort((a, b) => a - b);
  const medianSym = validSym[Math.floor(validSym.length / 2)] || 50;
  for (const c of all) {
    if (c.details.symmetry === 0) c.details.symmetry = medianSym;
  }

  // Step 2: Compute mean & std for each metric
  const stats = {};
  for (const m of METRICS) {
    const vals = all.map(c => c.details[m]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
    stats[m] = { mean, std };
  }

  // Step 3: Convert to 偏差値 (mean=50, std=10) and compute weighted score
  for (const c of all) {
    let total = 0;
    for (const m of METRICS) {
      const z = (c.details[m] - stats[m].mean) / stats[m].std;
      const tScore = 50 + 10 * z; // 偏差値
      total += tScore * WEIGHTS[m];
    }
    // Scale to ~40-80 range for display: total is around 50 (mean), spread ±15
    c.score = Math.round(total * 10) / 10;
    c.scores = calcScoreSet(c.score, c.age, c.totalFollowers);
    c.scoreWithAge = c.scores.faceAge;
    c.scoreCharm = c.scores.faceSns;
  }

  console.log('\n--- Score stats ---');
  console.log('Mean:', stats);
  const finalScores = all.map(c => c.score).sort((a, b) => a - b);
  console.log(`Score range: ${finalScores[0]} - ${finalScores[finalScores.length - 1]}`);

  // Sort by face score descending
  all.sort((a, b) => b.score - a.score);

  // Generate thumbnails
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.readdirSync(THUMB_DIR).forEach(f => fs.unlinkSync(path.join(THUMB_DIR, f)));

  // Use name-based IDs so thumbnails don't shuffle when rankings change
  const crypto = await import('crypto');
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    const hash = crypto.createHash('md5').update(c.name).digest('hex').slice(0, 8);
    const id = 'celeb_' + hash;
    c.id = id;
    c.thumbnail = 'data/thumbnails/' + id + '.jpg';

    try {
      const buf = fs.readFileSync(c._imgPath);
      const img = await canvas.loadImage(buf);
      const box = c._det.detection.box;

      if (box) {
        const padding = Math.max(box.width, box.height) * 0.4;
        const cropX = Math.max(0, Math.round(box.x - padding));
        const cropY = Math.max(0, Math.round(box.y - padding));
        const cropW = Math.min(img.width - cropX, Math.round(box.width + padding * 2));
        const cropH = Math.min(img.height - cropY, Math.round(box.height + padding * 2));
        await sharp(buf).extract({ left: cropX, top: cropY, width: Math.max(1, cropW), height: Math.max(1, cropH) })
          .resize(200, 200, { fit: 'cover' }).jpeg({ quality: 85 })
          .toFile(path.join(THUMB_DIR, id + '.jpg'));
      } else {
        await sharp(buf).resize(200, 200, { fit: 'cover' }).jpeg({ quality: 85 })
          .toFile(path.join(THUMB_DIR, id + '.jpg'));
      }
    } catch (e) {
      console.log(`  Thumb error for ${c.name}: ${e.message}`);
      try {
        await sharp(fs.readFileSync(c._imgPath)).resize(200, 200, { fit: 'cover' }).jpeg({ quality: 85 })
          .toFile(path.join(THUMB_DIR, id + '.jpg'));
      } catch (e2) {
        console.log(`  Fallback thumb also failed: ${e2.message}`);
      }
    }

    // Clean up internal fields
    delete c._imgPath;
    delete c._det;
  }

  // Write JSON
  fs.writeFileSync(path.join(OUTPUT_DIR, 'celebrities.json'), JSON.stringify(all, null, 2), 'utf-8');

  console.log(`\n========================================`);
  console.log(`Total: ${all.length} celebrities (skipped: ${skipped})`);
  console.log(`========================================`);
  all.forEach((c, i) => console.log(`  ${c.id} ${c.name} (${c.age}) ${c.gender} ${c.category} face=${c.scores.face}`));
}

main().catch(console.error);
