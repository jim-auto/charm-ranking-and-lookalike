import type { ScoreDetails } from '../types/celebrity';

interface Point {
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function ratioScore(actual: number, ideal: number): number {
  const deviation = Math.abs(actual - ideal) / ideal;
  return clamp((1 - deviation * 2) * 100);
}

function shapeRatioScore(actual: number, ideal: number, factor = 2): number {
  if (actual <= 0 || ideal <= 0) return 0;
  const deviation = Math.abs(actual - ideal) / ideal;
  return clamp((1 - deviation * factor) * 100);
}

function polylineLength(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += distance(points[i], points[i + 1]);
  }
  return total;
}

const SYMMETRY_AXIS_INDICES = [27, 28, 29, 30, 51, 57, 8] as const;
const SYMMETRY_PAIRS = [
  [1, 15, 0.8],
  [2, 14, 0.9],
  [3, 13, 1],
  [4, 12, 1],
  [5, 11, 1],
  [6, 10, 0.9],
  [7, 9, 0.8],
  [17, 26, 0.8],
  [18, 25, 0.9],
  [19, 24, 1],
  [20, 23, 0.9],
  [21, 22, 0.8],
  [36, 45, 1.4],
  [37, 44, 1.2],
  [38, 43, 1.2],
  [39, 42, 1.1],
  [40, 47, 1.1],
  [41, 46, 1.1],
  [31, 35, 1],
  [32, 34, 1],
  [48, 54, 1.1],
  [49, 53, 1],
  [50, 52, 0.9],
  [59, 55, 0.9],
  [58, 56, 0.9],
  [60, 64, 1],
  [61, 63, 0.9],
  [67, 65, 0.8],
] as const;

function rotatePoint(point: Point, origin: Point, angle: number): Point {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

function calculateGoldenRatio(landmarks: Point[]): number {
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

  const ratioScoreFace = ratioScore(faceRatio, 1.46);
  const ratioScoreEyes = ratioScore(eyeRatio, 1 / 1.618);
  return (ratioScoreFace + ratioScoreEyes) / 2;
}

function calculateSymmetry(landmarks: Point[], faceWidth: number): number {
  if (faceWidth <= 0) return 0;

  const leftEye = midpoint(landmarks[36], landmarks[39]);
  const rightEye = midpoint(landmarks[42], landmarks[45]);
  const eyeCenter = midpoint(leftEye, rightEye);
  const roll = -Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const rotated = landmarks.map((point) => rotatePoint(point, eyeCenter, roll));
  const faceHeight = distance(rotated[27], rotated[8]) * 1.3;
  if (faceHeight <= 0) return 0;

  const axisX =
    SYMMETRY_AXIS_INDICES.reduce((sum, index) => sum + rotated[index].x, 0) /
    SYMMETRY_AXIS_INDICES.length;

  let totalError = 0;
  let totalWeight = 0;
  for (const [leftIndex, rightIndex, weight] of SYMMETRY_PAIRS) {
    const left = rotated[leftIndex];
    const right = rotated[rightIndex];
    const xError = Math.abs((axisX - left.x) - (right.x - axisX)) / faceWidth;
    const yError = Math.abs(left.y - right.y) / faceHeight;
    totalError += (xError + yError * 0.6) * weight;
    totalWeight += weight;
  }

  const averageError = totalWeight > 0 ? totalError / totalWeight : 0;
  return clamp((1 - averageError * 2.4) * 100);
}

function calculateEyeScore(landmarks: Point[]): number {
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

function calculateNoseScore(landmarks: Point[]): number {
  const faceWidth = distance(landmarks[0], landmarks[16]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const noseLength = distance(landmarks[27], landmarks[30]);
  const faceHeight = distance(landmarks[27], landmarks[8]) * 1.3;

  const widthRatio = faceWidth > 0 ? ratioScore(noseWidth / faceWidth, 0.26) : 0;
  const lengthRatio = faceHeight > 0 ? ratioScore(noseLength / faceHeight, 0.33) : 0;
  return (widthRatio + lengthRatio) / 2;
}

function calculateMouthScore(landmarks: Point[]): number {
  const mouthWidth = distance(landmarks[48], landmarks[54]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const upperLipHeight = distance(landmarks[51], landmarks[62]);
  const lowerLipHeight = distance(landmarks[57], landmarks[66]);

  const widthRatio = noseWidth > 0 ? ratioScore(mouthWidth / noseWidth, 1.5) : 0;
  const lipRatio = lowerLipHeight > 0 ? ratioScore(upperLipHeight / lowerLipHeight, 0.8) : 0;
  return (widthRatio + lipRatio) / 2;
}

function calculateContourScore(landmarks: Point[]): number {
  const faceWidth = distance(landmarks[0], landmarks[16]);
  const faceHeight = distance(landmarks[27], landmarks[8]) * 1.3;
  const upperJawWidth = distance(landmarks[3], landmarks[13]);
  const midJawWidth = distance(landmarks[5], landmarks[11]);
  const chinWidth = distance(landmarks[7], landmarks[9]);
  const chinDepth = distance(midpoint(landmarks[5], landmarks[11]), landmarks[8]);

  const lowerLeftJaw = polylineLength(landmarks.slice(3, 9));
  const lowerRightJaw = polylineLength([...landmarks.slice(8, 14)].reverse());
  const lowerJawBalance =
    lowerLeftJaw > 0 && lowerRightJaw > 0
      ? Math.min(lowerLeftJaw, lowerRightJaw) / Math.max(lowerLeftJaw, lowerRightJaw)
      : 0;

  const jawLine = landmarks.slice(3, 14);
  let smoothness = 0;
  for (let i = 1; i < jawLine.length - 1; i++) {
    const expected = midpoint(jawLine[i - 1], jawLine[i + 1]);
    const deviation = distance(jawLine[i], expected);
    const segmentLength = distance(jawLine[i - 1], jawLine[i + 1]);
    smoothness += segmentLength > 0 ? deviation / segmentLength : 0;
  }
  const averageDeviation = smoothness / (jawLine.length - 2);

  const upperWidthScore = faceWidth > 0 ? shapeRatioScore(upperJawWidth / faceWidth, 0.72) : 0;
  const taperScore = upperJawWidth > 0 ? shapeRatioScore(midJawWidth / upperJawWidth, 0.65) : 0;
  const chinWidthScore = midJawWidth > 0 ? shapeRatioScore(chinWidth / midJawWidth, 0.32) : 0;
  const chinDepthScore = faceHeight > 0 ? shapeRatioScore(chinDepth / faceHeight, 0.065, 1.8) : 0;
  const balanceScore = shapeRatioScore(lowerJawBalance, 0.96, 1.2);
  const smoothnessScore = clamp((1 - averageDeviation * 6.5) * 100);

  return (
    upperWidthScore * 0.18 +
    taperScore * 0.22 +
    chinWidthScore * 0.2 +
    chinDepthScore * 0.18 +
    balanceScore * 0.12 +
    smoothnessScore * 0.1
  );
}

export function calculateFaceDetails(landmarks: Point[]): ScoreDetails {
  const faceWidth = distance(landmarks[0], landmarks[16]);
  return {
    symmetry: Math.round(calculateSymmetry(landmarks, faceWidth)),
    golden_ratio: Math.round(calculateGoldenRatio(landmarks)),
    eyes: Math.round(calculateEyeScore(landmarks)),
    nose: Math.round(calculateNoseScore(landmarks)),
    mouth: Math.round(calculateMouthScore(landmarks)),
    contour: Math.round(calculateContourScore(landmarks)),
  };
}
