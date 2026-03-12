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

  // Symmetry
  const jl = lm.slice(0, 8), jr = lm.slice(9, 17).reverse(), nb = lm[27];
  let td = 0;
  const pairs = Math.min(jl.length, jr.length);
  for (let i = 0; i < pairs; i++) td += Math.abs(Math.abs(jl[i].x - nb.x) - Math.abs(jr[i].x - nb.x));
  const symmetry = clamp((1 - td / pairs / fw * 4) * 100);

  // Golden ratio
  const fh = distance(lm[27], lm[8]) * 1.3;
  const le = midpoint(lm[36], lm[39]), re = midpoint(lm[42], lm[45]);
  const golden_ratio = (ratioScore(fh / fw, 1.46) + ratioScore(distance(le, re) / fw, 0.44)) / 2;

  // Eyes
  const lw = distance(lm[36], lm[39]), lh = distance(lm[37], lm[41]);
  const rw = distance(lm[42], lm[45]), rh = distance(lm[43], lm[47]);
  const bal = 1 - Math.abs(lw - rw) / ((lw + rw) / 2);
  const eyes = clamp(ratioScore((lh / lw + rh / rw) / 2, 0.33) * 0.6 + bal * 100 * 0.4);

  // Nose
  const nose = (ratioScore(distance(lm[31], lm[35]) / fw, 0.26) + ratioScore(distance(lm[27], lm[30]) / fh, 0.33)) / 2;

  // Mouth
  const mouth = (ratioScore(distance(lm[48], lm[54]) / distance(lm[31], lm[35]), 1.5) +
    ratioScore(distance(lm[51], lm[62]) / distance(lm[57], lm[66]), 0.8)) / 2;

  // Contour
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

const newPeople = [
  { name: '齋藤飛鳥', category: 'idol', age: 28, gender: 'female' },
  { name: 'MOMO(TWICE)', category: 'idol', age: 29, gender: 'female' },
  { name: 'SANA(TWICE)', category: 'idol', age: 29, gender: 'female' },
  { name: 'HIKAKIN', category: 'influencer', age: 37, gender: 'male' },
  { name: 'はじめしゃちょー', category: 'influencer', age: 33, gender: 'male' },
];

async function main() {
  console.log('Loading models...');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
  console.log('Models loaded.');

  const existing = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'celebrities.json'), 'utf-8'));

  // Add gender to existing entries
  const genderMap = {
    '橋本環奈': 'female', '長澤まさみ': 'female', '綾瀬はるか': 'female', '浜辺美波': 'female',
    '広瀬すず': 'female', '新垣結衣': 'female', '佐藤健': 'male', '山崎賢人': 'male',
  };
  existing.forEach(c => { c.gender = genderMap[c.name] || 'male'; });

  const results = [];
  for (const p of newPeople) {
    const imgPath = path.join(INPUT_DIR, p.name, 'photo.jpg');
    if (!fs.existsSync(imgPath)) { console.log('MISSING: ' + p.name); continue; }
    console.log('[process] ' + p.name + ' ...');
    try {
      const buf = fs.readFileSync(imgPath);
      const img = await canvas.loadImage(buf);
      const cvs = canvas.createCanvas(img.width, img.height);
      cvs.getContext('2d').drawImage(img, 0, 0);
      const det = await faceapi.detectSingleFace(cvs).withFaceLandmarks().withFaceDescriptor();
      if (!det) { console.log('  No face detected'); continue; }

      const lm = det.landmarks.positions.map(pt => ({ x: pt.x, y: pt.y }));
      const embedding = Array.from(det.descriptor);
      const { details, score: sc } = calcScore(lm);
      const swa = ageAdj(sc, p.age);

      results.push({
        name: p.name, category: p.category, age: p.age, gender: p.gender,
        score: sc, scoreWithAge: swa, details, embedding,
      });
      console.log(`  Score: ${sc} withAge: ${swa} sym=${details.symmetry} golden=${details.golden_ratio}`);
    } catch (e) {
      console.log('  Error: ' + e.message);
    }
  }

  // Merge all
  const all = [...existing, ...results];
  all.sort((a, b) => b.score - a.score);

  // Renumber IDs and regenerate thumbnails
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.readdirSync(THUMB_DIR).forEach(f => fs.unlinkSync(path.join(THUMB_DIR, f)));

  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    const newId = 'celeb_' + String(i + 1).padStart(3, '0');
    c.id = newId;
    c.thumbnail = 'data/thumbnails/' + newId + '.jpg';
    const inp = path.join(INPUT_DIR, c.name, 'photo.jpg');
    await sharp(inp).resize(200, 200, { fit: 'cover' }).jpeg({ quality: 85 }).toFile(path.join(THUMB_DIR, newId + '.jpg'));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'celebrities.json'), JSON.stringify(all, null, 2), 'utf-8');
  console.log('\nTotal: ' + all.length);
  all.forEach(c => console.log(`${c.id} ${c.name} ${c.gender} ${c.category} score=${c.score}`));
}

main().catch(console.error);
