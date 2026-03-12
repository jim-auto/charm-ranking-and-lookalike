/**
 * Generate celebrities.json from input_images/ using face-api.js (Node.js)
 *
 * Usage: node generate_data.mjs
 *
 * Expected structure:
 *   scripts/input_images/{name}/photo.jpg
 *   scripts/input_images/{name}/category.txt  (actor|actress|idol|influencer)
 */

import * as faceapi from 'face-api.js';
import canvas from 'canvas';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Monkey-patch for Node.js canvas support
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const INPUT_DIR = path.join(__dirname, 'input_images');
const OUTPUT_DIR = path.join(__dirname, '..', 'web', 'public', 'data');
const THUMB_DIR = path.join(OUTPUT_DIR, 'thumbnails');
const MODEL_DIR = path.join(__dirname, '..', 'web', 'public', 'models');

// Golden ratio scoring (same algorithm as web/src/lib/faceScoring.ts)
const GOLDEN_RATIO = 1.618;

function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function ratioScore(actual, ideal) {
  const deviation = Math.abs(actual - ideal) / ideal;
  return clamp((1 - deviation) * 100);
}

function calculateSymmetry(landmarks, faceWidth) {
  const jawLeft = landmarks.slice(0, 8);
  const jawRight = landmarks.slice(9, 17).reverse();
  const noseBridge = landmarks[27];

  let totalDev = 0;
  const pairs = Math.min(jawLeft.length, jawRight.length);
  for (let i = 0; i < pairs; i++) {
    const leftDist = Math.abs(jawLeft[i].x - noseBridge.x);
    const rightDist = Math.abs(jawRight[i].x - noseBridge.x);
    totalDev += Math.abs(leftDist - rightDist);
  }
  const avgDev = totalDev / pairs;
  return clamp((1 - (avgDev / faceWidth) * 4) * 100);
}

function calculateGoldenRatio(landmarks) {
  const jawLeft = landmarks[0];
  const jawRight = landmarks[16];
  const chin = landmarks[8];
  const foreheadApprox = landmarks[27];

  const faceWidth = distance(jawLeft, jawRight);
  const faceHeight = distance(foreheadApprox, chin) * 1.3;
  const faceRatio = faceHeight / faceWidth;

  const leftEye = midpoint(landmarks[36], landmarks[39]);
  const rightEye = midpoint(landmarks[42], landmarks[45]);
  const eyeDistance = distance(leftEye, rightEye);
  const eyeRatio = eyeDistance / faceWidth;

  const score1 = ratioScore(faceRatio, 1.46);
  const score2 = ratioScore(eyeRatio, 0.44);
  return (score1 + score2) / 2;
}

function calculateEyeScore(landmarks) {
  const leftEyeWidth = distance(landmarks[36], landmarks[39]);
  const leftEyeHeight = distance(landmarks[37], landmarks[41]);
  const rightEyeWidth = distance(landmarks[42], landmarks[45]);
  const rightEyeHeight = distance(landmarks[43], landmarks[47]);

  const leftRatio = leftEyeHeight / leftEyeWidth;
  const rightRatio = rightEyeHeight / rightEyeWidth;
  const avgRatio = (leftRatio + rightRatio) / 2;

  const sizeBalance = 1 - Math.abs(leftEyeWidth - rightEyeWidth) / ((leftEyeWidth + rightEyeWidth) / 2);
  const shapeScore = ratioScore(avgRatio, 0.33);
  return clamp(shapeScore * 0.6 + sizeBalance * 100 * 0.4);
}

function calculateNoseScore(landmarks) {
  const faceWidth = distance(landmarks[0], landmarks[16]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const noseLength = distance(landmarks[27], landmarks[30]);
  const faceHeight = distance(landmarks[27], landmarks[8]) * 1.3;

  const widthRatio = ratioScore(noseWidth / faceWidth, 0.26);
  const lengthRatio = ratioScore(noseLength / faceHeight, 0.33);
  return (widthRatio + lengthRatio) / 2;
}

function calculateMouthScore(landmarks) {
  const mouthWidth = distance(landmarks[48], landmarks[54]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const upperLipHeight = distance(landmarks[51], landmarks[62]);
  const lowerLipHeight = distance(landmarks[57], landmarks[66]);

  const widthRatio = ratioScore(mouthWidth / noseWidth, 1.5);
  const lipRatio = ratioScore(upperLipHeight / lowerLipHeight, 0.8);
  return (widthRatio + lipRatio) / 2;
}

function calculateContourScore(landmarks) {
  const jawLine = landmarks.slice(0, 17);
  let smoothness = 0;

  for (let i = 1; i < jawLine.length - 1; i++) {
    const expected = midpoint(jawLine[i - 1], jawLine[i + 1]);
    const deviation = distance(jawLine[i], expected);
    const segmentLen = distance(jawLine[i - 1], jawLine[i + 1]);
    smoothness += segmentLen > 0 ? deviation / segmentLen : 0;
  }

  const avgDeviation = smoothness / (jawLine.length - 2);
  return clamp((1 - avgDeviation * 8) * 100);
}

function calculateFaceScore(landmarks) {
  const faceWidth = distance(landmarks[0], landmarks[16]);
  const details = {
    symmetry: Math.round(calculateSymmetry(landmarks, faceWidth)),
    golden_ratio: Math.round(calculateGoldenRatio(landmarks)),
    eyes: Math.round(calculateEyeScore(landmarks)),
    nose: Math.round(calculateNoseScore(landmarks)),
    mouth: Math.round(calculateMouthScore(landmarks)),
    contour: Math.round(calculateContourScore(landmarks)),
    skin: 75,
  };

  const score =
    details.symmetry * 0.2 +
    details.golden_ratio * 0.25 +
    details.eyes * 0.15 +
    details.nose * 0.1 +
    details.mouth * 0.1 +
    details.contour * 0.1 +
    details.skin * 0.1;

  return { details, score: Math.round(score * 10) / 10 };
}

async function main() {
  // Load models
  console.log('Loading face-api.js models...');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
  console.log('Models loaded.');

  fs.mkdirSync(THUMB_DIR, { recursive: true });

  const dirs = fs.readdirSync(INPUT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const celebrities = [];
  let idx = 0;

  for (const name of dirs) {
    const personDir = path.join(INPUT_DIR, name);
    const imgPath = path.join(personDir, 'photo.jpg');
    const catPath = path.join(personDir, 'category.txt');

    if (!fs.existsSync(imgPath)) {
      console.log(`[skip] ${name} - no photo.jpg`);
      continue;
    }

    const category = fs.existsSync(catPath)
      ? fs.readFileSync(catPath, 'utf-8').trim()
      : 'actor';

    console.log(`[process] ${name} ...`);

    try {
      // Load image
      const imgBuffer = fs.readFileSync(imgPath);
      const img = await canvas.loadImage(imgBuffer);

      const cvs = canvas.createCanvas(img.width, img.height);
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Detect face
      const detection = await faceapi
        .detectSingleFace(cvs)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        console.log(`  No face detected, skipping.`);
        continue;
      }

      const landmarks = detection.landmarks.positions.map(p => ({ x: p.x, y: p.y }));
      const embedding = Array.from(detection.descriptor);
      const { details, score } = calculateFaceScore(landmarks);

      // Generate thumbnail (crop face area + padding, resize to 200x200)
      const box = detection.detection.box;
      const padding = Math.max(box.width, box.height) * 0.3;
      const cropX = Math.max(0, Math.round(box.x - padding));
      const cropY = Math.max(0, Math.round(box.y - padding));
      const cropW = Math.min(img.width - cropX, Math.round(box.width + padding * 2));
      const cropH = Math.min(img.height - cropY, Math.round(box.height + padding * 2));

      const id = `celeb_${String(idx + 1).padStart(3, '0')}`;
      const thumbPath = path.join(THUMB_DIR, `${id}.jpg`);

      await sharp(imgBuffer)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .resize(200, 200, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toFile(thumbPath);

      celebrities.push({
        id,
        name,
        category,
        score,
        details,
        embedding,
        thumbnail: `data/thumbnails/${id}.jpg`,
      });

      console.log(`  Score: ${score} | ${JSON.stringify(details)}`);
      idx++;
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }

  // Sort by score descending
  celebrities.sort((a, b) => b.score - a.score);

  // Write JSON
  const jsonPath = path.join(OUTPUT_DIR, 'celebrities.json');
  fs.writeFileSync(jsonPath, JSON.stringify(celebrities, null, 2), 'utf-8');
  console.log(`\nGenerated ${celebrities.length} celebrities -> ${jsonPath}`);
}

main().catch(console.error);
