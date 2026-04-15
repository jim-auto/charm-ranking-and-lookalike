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
const EMBEDDING_VARIANTS_JSON = path.join(DATA_DIR, 'embedding_variants.json');
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
const DETAIL_WEIGHTS = {
  golden_ratio: 0.4,
  eyes: 0.2,
  nose: 0.2,
  mouth: 0.2,
};

const { Canvas, Image, ImageData, loadImage } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
const NORMALIZED_EMBEDDING_SIZE = 200;
const EMBEDDING_PADDING_RATIO = 0.3;
const SMALL_FACE_ALTERNATE_AREA_THRESHOLD = 12;
const SMALL_FACE_ALTERNATE_MIN_BOX = 130;

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

function ratioScore(actual, ideal) {
  const deviation = Math.abs(actual - ideal) / ideal;
  return clamp((1 - deviation * 2) * 100);
}

function marginBalanceScore(a, b) {
  const total = a + b;
  if (total <= 0) return 0;
  return clamp((1 - Math.abs(a - b) / total) * 100);
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
  const baseScore = marginScore * 0.7 + sizeScore * 0.3;

  const closeupAreaScore = clamp(((areaRatio - 0.32) / 0.28) * 100);
  const centerednessScore = Math.min(
    marginBalanceScore(leftMargin, rightMargin),
    marginBalanceScore(topMargin, bottomMargin),
  );
  const closeupScore = closeupAreaScore * 0.45 + centerednessScore * 0.55;

  return round1(Math.max(baseScore, closeupScore));
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
  return round1(clamp(((meanEdge - 3) / 21) * 100));
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
  if (yawScore < 5 && faceAreaRatio < 3) blockingReasons.push('yaw_small_face');
  if (frontalScore < 12 && cropScore < 20) blockingReasons.push('frontal_and_crop');
  if (faceAreaRatio < 2) blockingReasons.push('face_too_small');
  if (cropScore < 18) blockingReasons.push('crop');
  if (sharpnessScore < 0.7) blockingReasons.push('blur');

  const diagnosisReady = blockingReasons.length === 0;
  const retryRecommended =
    !diagnosisReady ||
    frontalScore < 60 ||
    yawScore < 45 ||
    pitchScore < 35 ||
    cropScore < 30 ||
    sharpnessScore < 20 ||
    (pitchScore < 56 && cropScore < 45 && faceAreaRatio > 20);

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

function calculateGoldenRatio(landmarks) {
  const jawLeft = landmarks[0];
  const jawRight = landmarks[16];
  const chin = landmarks[8];
  const foreheadApprox = landmarks[27];

  const faceWidth = distance(jawLeft, jawRight);
  const faceHeight = distance(foreheadApprox, chin) * 1.3;
  const faceRatio = faceWidth > 0 ? faceHeight / faceWidth : 0;

  const leftEye = midpoint(landmarks[36], landmarks[39]);
  const rightEye = midpoint(landmarks[42], landmarks[45]);
  const eyeDistance = distance(leftEye, rightEye);
  const eyeRatio = faceWidth > 0 ? eyeDistance / faceWidth : 0;

  return (ratioScore(faceRatio, 1.46) + ratioScore(eyeRatio, 1 / 1.618)) / 2;
}

function calculateEyeScore(landmarks) {
  const leftEyeWidth = distance(landmarks[36], landmarks[39]);
  const leftEyeHeight = distance(landmarks[37], landmarks[41]);
  const rightEyeWidth = distance(landmarks[42], landmarks[45]);
  const rightEyeHeight = distance(landmarks[43], landmarks[47]);

  const leftRatio = leftEyeWidth > 0 ? leftEyeHeight / leftEyeWidth : 0;
  const rightRatio = rightEyeWidth > 0 ? rightEyeHeight / rightEyeWidth : 0;
  const avgRatio = (leftRatio + rightRatio) / 2;

  const avgWidth = (leftEyeWidth + rightEyeWidth) / 2;
  const sizeBalance =
    avgWidth > 0 ? 1 - Math.abs(leftEyeWidth - rightEyeWidth) / avgWidth : 0;
  const shapeScore = ratioScore(avgRatio, 0.33);

  return clamp(shapeScore * 0.6 + sizeBalance * 100 * 0.4);
}

function calculateNoseScore(landmarks) {
  const faceWidth = distance(landmarks[0], landmarks[16]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const noseLength = distance(landmarks[27], landmarks[30]);
  const faceHeight = distance(landmarks[27], landmarks[8]) * 1.3;

  const widthRatio = faceWidth > 0 ? ratioScore(noseWidth / faceWidth, 0.26) : 0;
  const lengthRatio = faceHeight > 0 ? ratioScore(noseLength / faceHeight, 0.33) : 0;
  return (widthRatio + lengthRatio) / 2;
}

function calculateMouthScore(landmarks) {
  const mouthWidth = distance(landmarks[48], landmarks[54]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const upperLipHeight = distance(landmarks[51], landmarks[62]);
  const lowerLipHeight = distance(landmarks[57], landmarks[66]);

  const widthRatio = noseWidth > 0 ? ratioScore(mouthWidth / noseWidth, 1.5) : 0;
  const lipRatio = lowerLipHeight > 0 ? ratioScore(upperLipHeight / lowerLipHeight, 0.8) : 0;
  return (widthRatio + lipRatio) / 2;
}

function calculateFaceDetails(landmarks) {
  return {
    golden_ratio: Math.round(calculateGoldenRatio(landmarks)),
    eyes: Math.round(calculateEyeScore(landmarks)),
    nose: Math.round(calculateNoseScore(landmarks)),
    mouth: Math.round(calculateMouthScore(landmarks)),
  };
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const lowerWeight = upper - index;
  const upperWeight = index - lower;
  return sortedValues[lower] * lowerWeight + sortedValues[upper] * upperWeight;
}

function roundMetric(value) {
  return Math.round(value * 10) / 10;
}

function calculateMetricDistributions(celebrities) {
  const metrics = ['golden_ratio', 'eyes', 'nose', 'mouth'];
  const distributions = {};
  for (const metric of metrics) {
    const values = celebrities
      .map((celebrity) => celebrity.details?.[metric])
      .filter((value) => typeof value === 'number')
      .map(Number);
    if (values.length === 0) continue;
    const sortedValues = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    distributions[metric] = {
      mean: roundMetric(mean),
      stdev: roundMetric(Math.sqrt(variance)),
      median: roundMetric(percentile(sortedValues, 0.5)),
    };
  }
  return distributions;
}

function calculateMetricDeviation(rawValue, distribution) {
  if (!distribution) return 50;
  if (distribution.stdev === 0) return 50;
  return round1(clamp(50 + 10 * ((rawValue - distribution.mean) / distribution.stdev), 20, 80));
}

function calculateAdjustedOverallScore(details, distributions) {
  return round1(
    calculateMetricDeviation(details.golden_ratio, distributions.golden_ratio) * 0.4 +
      calculateMetricDeviation(details.eyes, distributions.eyes) * 0.2 +
      calculateMetricDeviation(details.nose, distributions.nose) * 0.2 +
      calculateMetricDeviation(details.mouth, distributions.mouth) * 0.2,
  );
}

function toReliability(score) {
  return round1(Math.max(0, Math.min(1, (score - 40) / 60)));
}

function blendTowardMean(rawValue, meanValue, reliability) {
  const preserveShare = 0.25 + reliability * 0.75;
  return round1(clamp(meanValue + (rawValue - meanValue) * preserveShare));
}

function calibrateDiagnoseDetails(details, photoQuality, distributions) {
  const supportScores = {
    golden_ratio:
      photoQuality.frontalScore * 0.5 +
      photoQuality.cropScore * 0.35 +
      photoQuality.sharpnessScore * 0.15,
    eyes:
      photoQuality.frontalScore * 0.35 +
      photoQuality.sharpnessScore * 0.45 +
      photoQuality.cropScore * 0.2,
    nose:
      photoQuality.frontalScore * 0.55 +
      photoQuality.cropScore * 0.25 +
      photoQuality.sharpnessScore * 0.2,
    mouth:
      photoQuality.frontalScore * 0.45 +
      photoQuality.cropScore * 0.35 +
      photoQuality.sharpnessScore * 0.2,
  };

  const reliability = {
    golden_ratio: toReliability(supportScores.golden_ratio),
    eyes: toReliability(supportScores.eyes),
    nose: toReliability(supportScores.nose),
    mouth: toReliability(supportScores.mouth),
  };

  return {
    golden_ratio: blendTowardMean(
      details.golden_ratio,
      distributions.golden_ratio?.mean ?? 50,
      reliability.golden_ratio,
    ),
    eyes: blendTowardMean(
      details.eyes,
      distributions.eyes?.mean ?? 50,
      reliability.eyes,
    ),
    nose: blendTowardMean(
      details.nose,
      distributions.nose?.mean ?? 50,
      reliability.nose,
    ),
    mouth: blendTowardMean(
      details.mouth,
      distributions.mouth?.mean ?? 50,
      reliability.mouth,
    ),
  };
}

function calculateLookalikeSimilarity(userDetails, userScore, celebrity) {
  const detailSimilarity = Object.entries(DETAIL_WEIGHTS).reduce((sum, [key, weight]) => {
    const userValue = userDetails[key];
    const celebrityValue = celebrity.details?.[key];
    if (typeof userValue !== 'number' || typeof celebrityValue !== 'number') {
      return sum;
    }
    const closeness = clamp(100 - Math.abs(userValue - celebrityValue));
    return sum + closeness * weight;
  }, 0);

  const celebrityScore = celebrity.scores?.face ?? celebrity.score ?? 0;
  const scoreSimilarity = clamp(100 - Math.abs(userScore - celebrityScore) * 1.5);
  return round1(detailSimilarity * 0.8 + scoreSimilarity * 0.2);
}

function cosineToSimilarityPercent(cosineSimilarityValue) {
  return round1(clamp((cosineSimilarityValue + 1) * 50));
}

function calculateHybridLookalikeSimilarity(
  userDetails,
  userScore,
  celebrity,
  embeddingCosineSimilarity = null,
  detailWeight = 0.3,
) {
  const detailSimilarity = calculateLookalikeSimilarity(userDetails, userScore, celebrity);
  if (embeddingCosineSimilarity == null) {
    return detailSimilarity;
  }
  const embeddingSimilarity = cosineToSimilarityPercent(embeddingCosineSimilarity);
  const safeDetailWeight = clamp(detailWeight, 0.1, 0.5);
  return round1(embeddingSimilarity * (1 - safeDetailWeight) + detailSimilarity * safeDetailWeight);
}

function getLookalikeDetailWeight(photoQuality) {
  if (photoQuality.faceAreaRatio < 8) return 0.03;
  if (
    photoQuality.retryRecommended &&
    photoQuality.faceAreaRatio < 12 &&
    photoQuality.frontalScore < 50
  ) {
    return 0.06;
  }
  const baseWeight = 0.15 + ((photoQuality.overallScore - 40) / 60) * 0.2;
  return Math.max(0.15, Math.min(0.35, baseWeight));
}

function getLookalikeCandidateCount(photoQuality) {
  if (photoQuality.faceAreaRatio < 8) return 24;
  if (
    photoQuality.retryRecommended &&
    photoQuality.faceAreaRatio < 12 &&
    photoQuality.frontalScore < 50
  ) {
    return 18;
  }
  return 12;
}

function getLookalikeEmbeddingGapThreshold(photoQuality) {
  if (photoQuality.faceAreaRatio > 35 && photoQuality.sharpnessScore < 8) {
    return 0;
  }
  return 0.015;
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
  const variantEntries = fs.existsSync(EMBEDDING_VARIANTS_JSON)
    ? JSON.parse(fs.readFileSync(EMBEDDING_VARIANTS_JSON, 'utf-8'))
    : {};
  const count = buffer.readUInt32LE(0);
  const dimension = buffer.readUInt32LE(4);
  const values = new Float32Array(count * dimension);
  for (let i = 0; i < count * dimension; i++) {
    values[i] = buffer.readFloatLE(8 + i * 4);
  }
  return {
    count,
    dimension,
    index,
    values,
    variantEmbeddingsById: Object.fromEntries(
      Object.entries(variantEntries).map(([celebrityId, entries]) => [
        celebrityId,
        (Array.isArray(entries) ? entries : [])
          .map((entry) =>
            Array.isArray(entry?.embedding) && entry.embedding.length === dimension
              ? entry.embedding
              : null,
          )
          .filter(Boolean),
      ]),
    ),
  };
}

function getEmbedding(store, celebrityId) {
  const entry = store.index[celebrityId];
  if (!entry) return null;
  const start = entry.index * store.dimension;
  const end = start + store.dimension;
  return store.values.subarray(start, end);
}

function getEmbeddings(store, celebrityId) {
  const mainEmbedding = getEmbedding(store, celebrityId);
  const variantEmbeddings = store.variantEmbeddingsById[celebrityId] ?? [];
  return mainEmbedding ? [mainEmbedding, ...variantEmbeddings] : variantEmbeddings;
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

function buildDetectionAttempts(image) {
  const attempts = [{ source: image, scale: 1, offsetX: 0, offsetY: 0 }];
  const minDimension = Math.min(image.width, image.height);
  if (minDimension > 240) {
    return attempts;
  }

  const scale = minDimension <= 160 ? 3 : 2;
  const enlarged = canvas.createCanvas(image.width * scale, image.height * scale);
  const enlargedCtx = enlarged.getContext('2d');
  enlargedCtx.drawImage(image, 0, 0, enlarged.width, enlarged.height);
  attempts.push({ source: enlarged, scale, offsetX: 0, offsetY: 0 });

  const padX = Math.round(enlarged.width * 0.18);
  const padY = Math.round(enlarged.height * 0.18);
  const padded = canvas.createCanvas(enlarged.width + padX * 2, enlarged.height + padY * 2);
  const paddedCtx = padded.getContext('2d');
  paddedCtx.fillStyle = '#18181c';
  paddedCtx.fillRect(0, 0, padded.width, padded.height);
  paddedCtx.drawImage(enlarged, padX, padY);
  attempts.push({ source: padded, scale, offsetX: padX, offsetY: padY });

  return attempts;
}

function calculateFaceAreaRatio(image, box) {
  return ((box.width * box.height) / Math.max(image.width * image.height, 1)) * 100;
}

async function computeDescriptorFromBox(image, box) {
  const normalizedFace = extractNormalizedFaceCanvas(image, box);
  const descriptor = await faceapi.computeFaceDescriptor(normalizedFace);
  return Array.from(descriptor);
}

function blendEmbeddings(embeddings) {
  if (embeddings.length === 0) return null;
  const dimension = embeddings[0]?.length ?? 0;
  if (dimension === 0 || embeddings.some((embedding) => embedding.length !== dimension)) {
    return null;
  }

  const blended = new Array(dimension).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      blended[i] += embedding[i];
    }
  }

  let norm = 0;
  for (let i = 0; i < dimension; i++) {
    blended[i] /= embeddings.length;
    norm += blended[i] * blended[i];
  }

  const safeNorm = Math.sqrt(norm);
  if (safeNorm === 0) return null;

  for (let i = 0; i < dimension; i++) {
    blended[i] /= safeNorm;
  }

  return blended;
}

async function detectMappedFace(source, scale = 1, offsetX = 0, offsetY = 0) {
  const detection = await faceapi.detectSingleFace(source).withFaceLandmarks();
  if (!detection) return null;

  return {
    landmarks: detection.landmarks.positions.map((point) => ({
      x: (point.x - offsetX) / scale,
      y: (point.y - offsetY) / scale,
    })),
    box: {
      x: (detection.detection.box.x - offsetX) / scale,
      y: (detection.detection.box.y - offsetY) / scale,
      width: detection.detection.box.width / scale,
      height: detection.detection.box.height / scale,
    },
  };
}

async function buildAlternateEmbeddings(image, primaryBox) {
  if (calculateFaceAreaRatio(image, primaryBox) > SMALL_FACE_ALTERNATE_AREA_THRESHOLD) {
    return [];
  }

  const alternateScale =
    Math.min(primaryBox.width, primaryBox.height) < SMALL_FACE_ALTERNATE_MIN_BOX ? 3 : 2;
  const scaledCanvas = canvas.createCanvas(image.width * alternateScale, image.height * alternateScale);
  const scaledCtx = scaledCanvas.getContext('2d');
  scaledCtx.drawImage(image, 0, 0, scaledCanvas.width, scaledCanvas.height);

  const offsetX = Math.round(scaledCanvas.width * 0.18);
  const offsetY = Math.round(scaledCanvas.height * 0.18);
  const paddedCanvas = canvas.createCanvas(
    scaledCanvas.width + offsetX * 2,
    scaledCanvas.height + offsetY * 2,
  );
  const paddedCtx = paddedCanvas.getContext('2d');
  paddedCtx.fillStyle = '#18181c';
  paddedCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
  paddedCtx.drawImage(scaledCanvas, offsetX, offsetY);

  const alternateDetection = await detectMappedFace(
    paddedCanvas,
    alternateScale,
    offsetX,
    offsetY,
  );
  if (!alternateDetection) {
    return [];
  }

  return [await computeDescriptorFromBox(image, alternateDetection.box)];
}

async function detectFixture(fixturePath) {
  const img = await loadImage(fixturePath);
  let detection = null;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  for (const attempt of buildDetectionAttempts(img)) {
    detection = await detectMappedFace(
      attempt.source,
      attempt.scale,
      attempt.offsetX,
      attempt.offsetY,
    );
    if (detection) {
      scale = attempt.scale;
      offsetX = attempt.offsetX;
      offsetY = attempt.offsetY;
      break;
    }
  }

  if (!detection) return null;

  const cvs = canvas.createCanvas(img.width, img.height);
  const ctx = cvs.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const descriptor = await computeDescriptorFromBox(img, detection.box);
  const alternateEmbeddings =
    scale === 1 && offsetX === 0 && offsetY === 0
      ? await buildAlternateEmbeddings(img, detection.box)
      : [];
  const blendedEmbedding =
    alternateEmbeddings.length > 0 ? blendEmbeddings([descriptor, ...alternateEmbeddings]) : null;
  const queryAlternates = blendedEmbedding
    ? [...alternateEmbeddings, blendedEmbedding]
    : alternateEmbeddings;

  return {
    canvas: cvs,
    landmarks: detection.landmarks,
    embedding: descriptor,
    alternateEmbeddings: queryAlternates,
    box: detection.box,
  };
}

function findTargetRank(
  targetId,
  targetGender,
  detectionEmbeddings,
  userDetails,
  userScore,
  photoQuality,
  celebrities,
  embeddings,
) {
  const candidates = filterPublicCelebrities(celebrities).filter(
    (celebrity) => celebrity.gender === targetGender,
  );
  const detailWeight = getLookalikeDetailWeight(photoQuality);
  const candidateCount = getLookalikeCandidateCount(photoQuality);
  const embeddingGapThreshold = getLookalikeEmbeddingGapThreshold(photoQuality);
  const embeddingRanked = candidates
    .map((celebrity) => {
      let embeddingSimilarity = null;
      const candidateEmbeddings = getEmbeddings(embeddings, celebrity.id);
      if (candidateEmbeddings.length > 0) {
        for (const detectionEmbedding of detectionEmbeddings) {
          for (const embedding of candidateEmbeddings) {
            if (embedding.length !== detectionEmbedding.length) {
              continue;
            }
            const candidateSimilarity = cosineSimilarity(detectionEmbedding, embedding);
            embeddingSimilarity =
              embeddingSimilarity == null
                ? candidateSimilarity
                : Math.max(embeddingSimilarity, candidateSimilarity);
          }
        }
      }
      return {
        celebrity,
        embeddingSimilarity,
      };
    })
    .sort((a, b) => (b.embeddingSimilarity ?? -Infinity) - (a.embeddingSimilarity ?? -Infinity))
    .slice(0, candidateCount);

  const ranked = embeddingRanked
    .map((row) => ({
      celebrity: row.celebrity,
      embeddingSimilarity: row.embeddingSimilarity,
      similarity: calculateHybridLookalikeSimilarity(
        userDetails,
        userScore,
        row.celebrity,
        row.embeddingSimilarity,
        detailWeight,
      ),
    }))
    .sort((a, b) => {
      const embeddingGap = (b.embeddingSimilarity ?? -Infinity) - (a.embeddingSimilarity ?? -Infinity);
      if (Math.abs(embeddingGap) > embeddingGapThreshold) {
        return embeddingGap;
      }
      return b.similarity - a.similarity;
    });

  const targetIndex = ranked.findIndex((row) => row.celebrity.id === targetId);
  return {
    rank: targetIndex === -1 ? null : targetIndex + 1,
    top5: ranked.slice(0, 5).map((row) => ({
      id: row.celebrity.id,
      name: row.celebrity.name,
      similarity: round1(row.similarity),
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
  const publicCelebrities = filterPublicCelebrities(celebrities);
  const metricDistributionsByGender = {
    male: calculateMetricDistributions(
      publicCelebrities.filter((celebrity) => celebrity.gender === 'male'),
    ),
    female: calculateMetricDistributions(
      publicCelebrities.filter((celebrity) => celebrity.gender === 'female'),
    ),
  };
  const results = [];

  for (const caseDef of benchmark.cases) {
    const fixturePath = await ensureFixture(caseDef, celebritiesById);
    const detection = await detectFixture(fixturePath);

    let photoQuality = null;
    let userDetails = null;
    let userScore = null;
    let targetRank = null;
    let top5 = [];

    if (detection) {
      photoQuality = calculatePhotoQuality(detection.landmarks, detection.box, detection.canvas);
      if (caseDef.targetId) {
        const targetCelebrity = celebritiesById.get(caseDef.targetId);
        if (targetCelebrity) {
          const baseDetails = calculateFaceDetails(detection.landmarks);
          const distributions = metricDistributionsByGender[targetCelebrity.gender] ?? {};
          userDetails = calibrateDiagnoseDetails(baseDetails, photoQuality, distributions);
          userScore = calculateAdjustedOverallScore(userDetails, distributions);
          const rankInfo = findTargetRank(
            caseDef.targetId,
            targetCelebrity.gender,
            [detection.embedding, ...(detection.alternateEmbeddings ?? [])],
            userDetails,
            userScore,
            photoQuality,
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
