/**
 * Merge young celebrities into existing celebrities.json
 * Usage: node scripts/merge_young.mjs
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
    mouth: Math.round(mouth), contour: Math.round(contour), skin: 75,
  };

  const total = details.symmetry * 0.2 + details.golden_ratio * 0.25 + details.eyes * 0.15 +
    details.nose * 0.1 + details.mouth * 0.1 + details.contour * 0.1 + details.skin * 0.1;

  return { details, score: Math.round(total * 10) / 10 };
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

// New young celebrities to add (age as of 2026)
const newPeople = [
  {
    name: '芦田愛菜', category: 'actress', age: 21, gender: 'female',
    sns: { instagram: 0, twitter: 0, tiktok: 0, youtube: 0 }, totalFollowers: 0,
  },
  {
    name: '清原果耶', category: 'actress', age: 23, gender: 'female',
    sns: { instagram: 1200000, twitter: 0, tiktok: 0, youtube: 0 }, totalFollowers: 1200000,
  },
  {
    name: '上白石萌歌', category: 'actress', age: 26, gender: 'female',
    sns: { instagram: 800000, twitter: 300000, tiktok: 0, youtube: 0 }, totalFollowers: 1100000,
  },
  {
    name: '南沙良', category: 'actress', age: 23, gender: 'female',
    sns: { instagram: 500000, twitter: 0, tiktok: 0, youtube: 0 }, totalFollowers: 500000,
  },
  {
    name: '道枝駿佑', category: 'idol', age: 23, gender: 'male',
    sns: { instagram: 0, twitter: 0, tiktok: 0, youtube: 0 }, totalFollowers: 0,
  },
  {
    name: 'Koki', category: 'influencer', age: 22, gender: 'female',
    sns: { instagram: 7800000, twitter: 0, tiktok: 2000000, youtube: 500000 }, totalFollowers: 10300000,
  },
  {
    name: '与田祐希', category: 'idol', age: 25, gender: 'female',
    sns: { instagram: 0, twitter: 0, tiktok: 0, youtube: 0 }, totalFollowers: 0,
  },
];

async function main() {
  console.log('Loading models...');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
  console.log('Models loaded.');

  const existing = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'celebrities.json'), 'utf-8'));
  const existingNames = new Set(existing.map(c => c.name));

  const results = [];
  for (const p of newPeople) {
    if (existingNames.has(p.name)) {
      console.log(`[skip] ${p.name} - already exists`);
      continue;
    }

    const imgPath = path.join(INPUT_DIR, p.name, 'photo.jpg');
    if (!fs.existsSync(imgPath)) {
      console.log(`[missing] ${p.name} - no photo.jpg`);
      continue;
    }

    console.log(`[process] ${p.name} ...`);
    try {
      const buf = fs.readFileSync(imgPath);
      const img = await canvas.loadImage(buf);
      const cvs = canvas.createCanvas(img.width, img.height);
      cvs.getContext('2d').drawImage(img, 0, 0);

      const det = await faceapi.detectSingleFace(cvs).withFaceLandmarks().withFaceDescriptor();
      if (!det) {
        console.log(`  No face detected`);
        continue;
      }

      const lm = det.landmarks.positions.map(pt => ({ x: pt.x, y: pt.y }));
      const embedding = Array.from(det.descriptor);
      const { details, score } = calcScore(lm);
      const scores = calcScoreSet(score, p.age, p.totalFollowers);

      results.push({
        name: p.name,
        category: p.category,
        age: p.age,
        gender: p.gender,
        score: score,
        scoreWithAge: scores.faceAge,
        scoreCharm: scores.faceSns,
        scores,
        sns: p.sns,
        totalFollowers: p.totalFollowers,
        details,
        embedding,
        thumbnail: '', // will be set after sorting
      });

      console.log(`  Score: ${score} | age-adj: ${scores.faceAge} | ${JSON.stringify(details)}`);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // Merge
  const all = [...existing, ...results];
  all.sort((a, b) => b.score - a.score);

  // Renumber IDs and regenerate thumbnails
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  // Remove old thumbnails
  fs.readdirSync(THUMB_DIR).forEach(f => fs.unlinkSync(path.join(THUMB_DIR, f)));

  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    const newId = 'celeb_' + String(i + 1).padStart(3, '0');
    c.id = newId;
    c.thumbnail = 'data/thumbnails/' + newId + '.jpg';

    const inp = path.join(INPUT_DIR, c.name, 'photo.jpg');
    if (!fs.existsSync(inp)) {
      console.log(`[warn] No source image for ${c.name}`);
      continue;
    }

    try {
      // Try face-crop for better thumbnails
      const buf = fs.readFileSync(inp);
      const img = await canvas.loadImage(buf);
      const cvs = canvas.createCanvas(img.width, img.height);
      cvs.getContext('2d').drawImage(img, 0, 0);
      const det = await faceapi.detectSingleFace(cvs);

      if (det) {
        const box = det.box;
        const padding = Math.max(box.width, box.height) * 0.4;
        const cropX = Math.max(0, Math.round(box.x - padding));
        const cropY = Math.max(0, Math.round(box.y - padding));
        const cropW = Math.min(img.width - cropX, Math.round(box.width + padding * 2));
        const cropH = Math.min(img.height - cropY, Math.round(box.height + padding * 2));

        await sharp(buf)
          .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 85 })
          .toFile(path.join(THUMB_DIR, newId + '.jpg'));
      } else {
        await sharp(buf)
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 85 })
          .toFile(path.join(THUMB_DIR, newId + '.jpg'));
      }
    } catch (e) {
      console.log(`[thumb error] ${c.name}: ${e.message}`);
      // Fallback
      await sharp(fs.readFileSync(inp))
        .resize(200, 200, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toFile(path.join(THUMB_DIR, newId + '.jpg'));
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'celebrities.json'), JSON.stringify(all, null, 2), 'utf-8');
  console.log(`\nTotal: ${all.length} celebrities`);
  all.forEach(c => console.log(`  ${c.id} ${c.name} (${c.age}) ${c.gender} ${c.category} face=${c.scores?.face ?? c.score}`));
}

main().catch(console.error);
