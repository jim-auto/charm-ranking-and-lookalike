import * as faceapi from 'face-api.js';
import canvas from 'canvas';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'web', 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const MODEL_DIR = path.join(PUBLIC_DIR, 'models');
const FIXTURE_DIR = path.join(__dirname, 'diagnose_benchmark_fixtures');
const DEFAULT_BENCHMARK_PATH = path.join(__dirname, 'diagnose_benchmark.json');
const DEFAULT_JSON_OUT = path.join(__dirname, 'diagnose_benchmark_latest.json');
const INPUT_IMAGES_DIR = path.join(__dirname, 'input_images');
const DIMENSION = 128;
const MAX_PUBLIC_AGE = 39;
const SOFT_BLUR_RADIUS = 1.35;
const ROTATE_RETRY_DEGREES = 10;
const SMALL_FACE_SIZE = 240;
const SMALL_FACE_PADDING = 110;

const { Canvas, Image, ImageData, loadImage } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
const NORMALIZED_EMBEDDING_SIZE = 200;
const EMBEDDING_PADDING_RATIO = 0.3;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function averagePoint(points) {
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function shapeRatioScore(actual, ideal, factor = 2) {
  if (actual <= 0 || ideal <= 0) return 0;
  const deviation = Math.abs(actual - ideal) / ideal;
  return clamp((1 - deviation * factor) * 100);
}

function rotatePoint(point, origin, angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

function rotateLandmarks(landmarks) {
  const leftEye = midpoint(landmarks[36], landmarks[39]);
  const rightEye = midpoint(landmarks[42], landmarks[45]);
  const eyeCenter = midpoint(leftEye, rightEye);
  const roll = -Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  return landmarks.map((point) => rotatePoint(point, eyeCenter, roll));
}

function getRollDegrees(landmarks) {
  const leftEye = midpoint(landmarks[36], landmarks[39]);
  const rightEye = midpoint(landmarks[42], landmarks[45]);
  return (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI;
}

function calculateYawScore(rotated) {
  const faceWidth = distance(rotated[3], rotated[13]);
  if (faceWidth <= 0) return 0;

  const axisX = averagePoint([rotated[27], rotated[28], rotated[29], rotated[30], rotated[33]]).x;
  const leftWidth = axisX - rotated[3].x;
  const rightWidth = rotated[13].x - axisX;
  const jawImbalance =
    leftWidth > 0 && rightWidth > 0
      ? Math.abs(leftWidth - rightWidth) / Math.max(leftWidth, rightWidth)
      : 1;

  const leftEyeWidth = distance(rotated[36], rotated[39]);
  const rightEyeWidth = distance(rotated[42], rotated[45]);
  const eyeImbalance =
    leftEyeWidth > 0 && rightEyeWidth > 0
      ? Math.abs(leftEyeWidth - rightEyeWidth) / Math.max(leftEyeWidth, rightEyeWidth)
      : 1;

  const noseLeft = axisX - rotated[31].x;
  const noseRight = rotated[35].x - axisX;
  const noseImbalance =
    noseLeft > 0 && noseRight > 0
      ? Math.abs(noseLeft - noseRight) / Math.max(noseLeft, noseRight)
      : 1;

  const mouthAxisOffset = Math.abs(midpoint(rotated[51], rotated[57]).x - axisX) / faceWidth;
  const weightedError =
    jawImbalance * 0.42 +
    eyeImbalance * 0.24 +
    noseImbalance * 0.22 +
    mouthAxisOffset * 0.12;

  return round1(clamp((1 - weightedError * 2.7) * 100));
}

function calculatePitchScore(rotated) {
  const eyeCenter = midpoint(midpoint(rotated[36], rotated[39]), midpoint(rotated[42], rotated[45]));
  const noseBase = rotated[33];
  const mouthCenter = midpoint(rotated[51], rotated[57]);
  const chin = rotated[8];
  const faceHeight = distance(rotated[27], chin) * 1.3;
  if (faceHeight <= 0) return 0;

  const eyeToNose = Math.abs(noseBase.y - eyeCenter.y);
  const noseToMouth = Math.abs(mouthCenter.y - noseBase.y);
  const mouthToChin = Math.abs(chin.y - mouthCenter.y);

  const upperMidScore = shapeRatioScore(eyeToNose / Math.max(noseToMouth, 1), 1.35, 1.6);
  const upperLowerScore = shapeRatioScore(
    (eyeToNose + noseToMouth) / Math.max(mouthToChin, 1),
    2.0,
    1.5,
  );
  const lowerShareScore = shapeRatioScore(mouthToChin / faceHeight, 0.24, 2.0);

  return round1(upperMidScore * 0.35 + upperLowerScore * 0.4 + lowerShareScore * 0.25);
}

function calculateCropScore(box, canvasElement) {
  const leftMargin = box.x / box.width;
  const rightMargin = (canvasElement.width - (box.x + box.width)) / box.width;
  const topMargin = box.y / box.height;
  const bottomMargin = (canvasElement.height - (box.y + box.height)) / box.height;
  const minMargin = Math.min(leftMargin, rightMargin, topMargin, bottomMargin);
  const marginScore = clamp(((minMargin - 0.02) / 0.12) * 100);

  const areaRatio = (box.width * box.height) / Math.max(canvasElement.width * canvasElement.height, 1);
  const sizeScore = shapeRatioScore(areaRatio, 0.18, 0.9);
  return round1(marginScore * 0.7 + sizeScore * 0.3);
}

function calculateSharpnessScore(box, canvasElement) {
  const ctx = canvasElement.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 50;

  const insetX = box.width * 0.15;
  const insetY = box.height * 0.15;
  const x = Math.max(0, Math.floor(box.x + insetX));
  const y = Math.max(0, Math.floor(box.y + insetY));
  const width = Math.max(16, Math.floor(box.width - insetX * 2));
  const height = Math.max(16, Math.floor(box.height - insetY * 2));
  const safeWidth = Math.min(width, canvasElement.width - x);
  const safeHeight = Math.min(height, canvasElement.height - y);
  if (safeWidth < 16 || safeHeight < 16) return 50;

  const { data } = ctx.getImageData(x, y, safeWidth, safeHeight);
  const gray = new Float32Array(safeWidth * safeHeight);
  for (let i = 0; i < safeWidth * safeHeight; i++) {
    const offset = i * 4;
    gray[i] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }

  let total = 0;
  let count = 0;
  for (let row = 1; row < safeHeight - 1; row += 2) {
    for (let col = 1; col < safeWidth - 1; col += 2) {
      const index = row * safeWidth + col;
      const laplacian = Math.abs(
        gray[index] * 4 -
          gray[index - 1] -
          gray[index + 1] -
          gray[index - safeWidth] -
          gray[index + safeWidth],
      );
      total += laplacian;
      count += 1;
    }
  }

  const meanEdge = count > 0 ? total / count : 0;
  return round1(clamp(((meanEdge - 6) / 18) * 100));
}

function calculatePhotoQuality(landmarks, box, canvasElement) {
  const rollDegrees = round1(getRollDegrees(landmarks));
  const rollScore = round1(clamp(100 - (Math.abs(rollDegrees) / 16) * 100));
  const rotated = rotateLandmarks(landmarks);
  const yawScore = calculateYawScore(rotated);
  const pitchScore = calculatePitchScore(rotated);
  const frontalScore = round1(rollScore * 0.2 + yawScore * 0.5 + pitchScore * 0.3);
  const cropScore = calculateCropScore(box, canvasElement);
  const sharpnessScore = calculateSharpnessScore(box, canvasElement);
  const faceAreaRatio = round1(
    ((box.width * box.height) / Math.max(canvasElement.width * canvasElement.height, 1)) * 100,
  );
  const overallScore = round1(frontalScore * 0.55 + sharpnessScore * 0.25 + cropScore * 0.2);

  const blockingReasons = [];
  if (pitchScore < 18) blockingReasons.push('pitch');
  if (Math.abs(rollDegrees) > 22) blockingReasons.push('roll');
  if (yawScore < 5 && faceAreaRatio < 10) blockingReasons.push('yaw_small_face');
  if (frontalScore < 20 && cropScore < 40) blockingReasons.push('frontal_and_crop');
  if (faceAreaRatio < 6) blockingReasons.push('face_too_small');
  if (cropScore < 18) blockingReasons.push('crop');
  if (sharpnessScore < 10) blockingReasons.push('blur');

  const diagnosisReady = blockingReasons.length === 0;
  const retryRecommended =
    !diagnosisReady ||
    overallScore < 55 ||
    frontalScore < 60 ||
    yawScore < 45 ||
    pitchScore < 35 ||
    cropScore < 30 ||
    sharpnessScore < 20;

  return {
    overallScore,
    frontalScore,
    sharpnessScore,
    cropScore,
    faceAreaRatio,
    yawScore,
    pitchScore,
    rollDegrees,
    diagnosisReady,
    retryRecommended,
    blockingReasons,
  };
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

function loadCelebrities() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'celebrities.json'), 'utf-8'));
}

function loadBenchmark(benchmarkPath) {
  return JSON.parse(fs.readFileSync(benchmarkPath, 'utf-8'));
}

function loadEmbeddingStore() {
  const index = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'embeddings_index.json'), 'utf-8'));
  const buffer = fs.readFileSync(path.join(DATA_DIR, 'embeddings.bin'));
  const count = buffer.readUInt32LE(0);
  const dimension = buffer.readUInt32LE(4);
  const values = new Float32Array(count * dimension);
  for (let i = 0; i < count * dimension; i++) {
    values[i] = buffer.readFloatLE(8 + i * 4);
  }
  return { count, dimension, index, values };
}

function getEmbedding(store, celebrityId) {
  const entry = store.index[celebrityId];
  if (!entry) return null;
  const start = entry.index * store.dimension;
  const end = start + store.dimension;
  return store.values.subarray(start, end);
}

function filterPublicCelebrities(celebrities) {
  return celebrities.filter(
    (celebrity) =>
      typeof celebrity.age === 'number' &&
      celebrity.age <= MAX_PUBLIC_AGE &&
      celebrity.rankingEligible !== false &&
      celebrity.faceValidationStatus !== 'rejected',
  );
}

async function ensureFixture(caseDef, celebritiesById) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const fixturePath = path.join(FIXTURE_DIR, `${caseDef.label}.jpg`);

  if (caseDef.variant === 'blank') {
    await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        background: { r: 40, g: 40, b: 48 },
      },
    })
      .jpeg({ quality: 90 })
      .toFile(fixturePath);
    return fixturePath;
  }

  const celebrity = celebritiesById.get(caseDef.targetId);
  if (!celebrity) {
    throw new Error(`Unknown targetId: ${caseDef.targetId}`);
  }

  let sourcePath;
  if (caseDef.source === 'input_photo') {
    sourcePath = path.join(INPUT_IMAGES_DIR, celebrity.name, 'photo.jpg');
  } else {
    sourcePath = path.join(PUBLIC_DIR, celebrity.thumbnail);
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source: ${sourcePath}`);
  }

  const source = sharp(sourcePath);
  const metadata = await source.metadata();
  const width = metadata.width ?? 200;
  const height = metadata.height ?? 200;

  if (caseDef.variant === 'original') {
    await source.jpeg({ quality: 90 }).toFile(fixturePath);
    return fixturePath;
  }

  if (caseDef.variant === 'jpeg_low') {
    await source.jpeg({ quality: 50 }).toFile(fixturePath);
    return fixturePath;
  }

  if (caseDef.variant === 'resize_phone') {
    await source
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(fixturePath);
    return fixturePath;
  }

  if (caseDef.variant === 'soft_blur') {
    await source
      .resize(360, 360, { fit: 'cover' })
      .blur(SOFT_BLUR_RADIUS)
      .jpeg({ quality: 88 })
      .toFile(fixturePath);
    return fixturePath;
  }

  if (caseDef.variant === 'rotate_12') {
    await source
      .resize(360, 360, { fit: 'cover' })
      .rotate(ROTATE_RETRY_DEGREES, { background: { r: 24, g: 24, b: 28 } })
      .sharpen(0.4)
      .extend({
        top: 16,
        bottom: 16,
        left: 16,
        right: 16,
        background: { r: 24, g: 24, b: 28 },
      })
      .jpeg({ quality: 90 })
      .toFile(fixturePath);
    return fixturePath;
  }

  if (caseDef.variant === 'small_face') {
    await source
      .resize(SMALL_FACE_SIZE, SMALL_FACE_SIZE, { fit: 'cover' })
      .extend({
        top: SMALL_FACE_PADDING,
        bottom: SMALL_FACE_PADDING,
        left: SMALL_FACE_PADDING,
        right: SMALL_FACE_PADDING,
        background: { r: 18, g: 18, b: 22 },
      })
      .jpeg({ quality: 90 })
      .toFile(fixturePath);
    return fixturePath;
  }

  if (caseDef.variant === 'tiny_face') {
    await source
      .resize(72, 72, { fit: 'cover' })
      .extend({
        top: 284,
        bottom: 284,
        left: 284,
        right: 284,
        background: { r: 18, g: 18, b: 22 },
      })
      .jpeg({ quality: 90 })
      .toFile(fixturePath);
    return fixturePath;
  }

  if (caseDef.variant === 'half_crop') {
    await source
      .extract({
        left: Math.floor(width * 0.48),
        top: 0,
        width: Math.max(40, Math.floor(width * 0.52)),
        height,
      })
      .resize(320, 320, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toFile(fixturePath);
    return fixturePath;
  }

  throw new Error(`Unknown variant: ${caseDef.variant}`);
}

function extractNormalizedFaceCanvas(image, box) {
  const output = canvas.createCanvas(NORMALIZED_EMBEDDING_SIZE, NORMALIZED_EMBEDDING_SIZE);
  const ctx = output.getContext('2d');
  const padding = Math.max(box.width, box.height) * EMBEDDING_PADDING_RATIO;
  const cropX = Math.max(0, Math.floor(box.x - padding));
  const cropY = Math.max(0, Math.floor(box.y - padding));
  const cropWidth = Math.max(
    1,
    Math.min(image.width - cropX, Math.floor(box.width + padding * 2)),
  );
  const cropHeight = Math.max(
    1,
    Math.min(image.height - cropY, Math.floor(box.height + padding * 2)),
  );

  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    NORMALIZED_EMBEDDING_SIZE,
    NORMALIZED_EMBEDDING_SIZE,
  );
  return output;
}

async function detectFixture(fixturePath) {
  const img = await loadImage(fixturePath);
  const detection = await faceapi.detectSingleFace(img).withFaceLandmarks();
  if (!detection) return null;

  const cvs = canvas.createCanvas(img.width, img.height);
  const ctx = cvs.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const box = {
    x: detection.detection.box.x,
    y: detection.detection.box.y,
    width: detection.detection.box.width,
    height: detection.detection.box.height,
  };
  const normalizedFace = extractNormalizedFaceCanvas(img, box);
  const descriptor = await faceapi.computeFaceDescriptor(normalizedFace);

  return {
    canvas: cvs,
    landmarks: detection.landmarks.positions.map((point) => ({ x: point.x, y: point.y })),
    embedding: Array.from(descriptor),
    box,
  };
}

function findTargetRank(targetId, targetGender, detectionEmbedding, celebrities, embeddings) {
  const candidates = filterPublicCelebrities(celebrities).filter(
    (celebrity) => celebrity.gender === targetGender,
  );
  const ranked = candidates
    .map((celebrity) => ({
      celebrity,
      similarity: cosineSimilarity(detectionEmbedding, getEmbedding(embeddings, celebrity.id)),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const targetIndex = ranked.findIndex((row) => row.celebrity.id === targetId);
  return {
    rank: targetIndex === -1 ? null : targetIndex + 1,
    top5: ranked.slice(0, 5).map((row) => ({
      id: row.celebrity.id,
      name: row.celebrity.name,
      similarity: round1(((row.similarity + 1) / 2) * 100),
    })),
  };
}

function evaluateCase(caseDef, actual) {
  if (caseDef.kind === 'reject') {
    return !actual.detected || !actual.photoQuality?.diagnosisReady;
  }

  if (!actual.detected || !actual.photoQuality) return false;
  if (!actual.photoQuality.diagnosisReady) return false;

  if (caseDef.kind === 'accept') {
    return !actual.photoQuality.retryRecommended && actual.targetRank != null && actual.targetRank <= caseDef.maxTargetRank;
  }

  if (caseDef.kind === 'retry') {
    return actual.photoQuality.retryRecommended && actual.targetRank != null && actual.targetRank <= caseDef.maxTargetRank;
  }

  if (caseDef.kind === 'accept_or_retry') {
    return actual.targetRank != null && actual.targetRank <= caseDef.maxTargetRank;
  }

  return false;
}

async function main() {
  const benchmarkPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_BENCHMARK_PATH;
  const jsonOut = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_JSON_OUT;

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);

  const benchmark = loadBenchmark(benchmarkPath);
  const celebrities = loadCelebrities();
  const celebritiesById = new Map(celebrities.map((celebrity) => [celebrity.id, celebrity]));
  const embeddings = loadEmbeddingStore();
  const results = [];

  for (const caseDef of benchmark.cases) {
    const fixturePath = await ensureFixture(caseDef, celebritiesById);
    const detection = await detectFixture(fixturePath);

    let photoQuality = null;
    let targetRank = null;
    let top5 = [];

    if (detection) {
      photoQuality = calculatePhotoQuality(detection.landmarks, detection.box, detection.canvas);
      if (caseDef.targetId) {
        const targetCelebrity = celebritiesById.get(caseDef.targetId);
        if (targetCelebrity) {
          const rankInfo = findTargetRank(
            caseDef.targetId,
            targetCelebrity.gender,
            detection.embedding,
            celebrities,
            embeddings,
          );
          targetRank = rankInfo.rank;
          top5 = rankInfo.top5;
        }
      }
    }

    const actual = {
      detected: Boolean(detection),
      photoQuality,
      targetRank,
      top5,
    };

    results.push({
      label: caseDef.label,
      kind: caseDef.kind,
      variant: caseDef.variant,
      targetId: caseDef.targetId ?? null,
      fixturePath: path.relative(PROJECT_ROOT, fixturePath).replaceAll('\\', '/'),
      passed: evaluateCase(caseDef, actual),
      detected: actual.detected,
      diagnosisReady: actual.photoQuality?.diagnosisReady ?? false,
      retryRecommended: actual.photoQuality?.retryRecommended ?? false,
      targetRank: actual.targetRank,
      photoQuality: actual.photoQuality,
      top5: actual.top5,
    });
  }

  const passed = results.filter((result) => result.passed).length;
  const report = {
    benchmarkPath: path.relative(PROJECT_ROOT, benchmarkPath).replaceAll('\\', '/'),
    summary: {
      cases: results.length,
      passed,
      failed: results.length - passed,
      accuracy: results.length ? round1((passed / results.length) * 100) : 0,
    },
    byKind: ['accept', 'retry', 'reject', 'accept_or_retry'].filter((kind) => results.some((r) => r.kind === kind)).map((kind) => {
      const subset = results.filter((result) => result.kind === kind);
      const subsetPassed = subset.filter((result) => result.passed).length;
      return {
        kind,
        cases: subset.length,
        passed: subsetPassed,
        accuracy: subset.length ? round1((subsetPassed / subset.length) * 100) : 0,
      };
    }),
    failures: results.filter((result) => !result.passed),
    results,
  };

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf-8');

  console.log('== Diagnose Benchmark ==');
  console.log(`Cases: ${report.summary.cases}`);
  console.log(`Passed: ${report.summary.passed}/${report.summary.cases} (${report.summary.accuracy}%)`);
  for (const kind of report.byKind) {
    console.log(`  ${kind.kind}: ${kind.passed}/${kind.cases} (${kind.accuracy}%)`);
  }
  if (report.failures.length > 0) {
    console.log('Failures:');
    for (const failure of report.failures.slice(0, 10)) {
      console.log(
        `  ${failure.label} detected=${failure.detected} diagnosisReady=${failure.diagnosisReady} retry=${failure.retryRecommended} targetRank=${failure.targetRank}`,
      );
    }
  } else {
    console.log('  No failures');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
