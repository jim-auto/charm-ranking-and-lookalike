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
  return clamp((1 - deviation) * 100);
}

export function calculateSymmetry(landmarks: Point[], faceWidth: number): number {
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
  return clamp((1 - avgDev / faceWidth * 4) * 100);
}

export function calculateGoldenRatio(landmarks: Point[]): number {
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

  const score1 = ratioScore(faceRatio, 1.46); // 日本人の理想比率（やや縦長）
  const score2 = ratioScore(eyeRatio, 0.44); // 日本人の平均的な目間距離/顔幅

  return (score1 + score2) / 2;
}

export function calculateEyeScore(landmarks: Point[]): number {
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

export function calculateNoseScore(landmarks: Point[]): number {
  const faceWidth = distance(landmarks[0], landmarks[16]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const noseLength = distance(landmarks[27], landmarks[30]);
  const faceHeight = distance(landmarks[27], landmarks[8]) * 1.3;

  const widthRatio = ratioScore(noseWidth / faceWidth, 0.26);
  const lengthRatio = ratioScore(noseLength / faceHeight, 0.33);

  return (widthRatio + lengthRatio) / 2;
}

export function calculateMouthScore(landmarks: Point[]): number {
  const mouthWidth = distance(landmarks[48], landmarks[54]);
  const noseWidth = distance(landmarks[31], landmarks[35]);
  const upperLipHeight = distance(landmarks[51], landmarks[62]);
  const lowerLipHeight = distance(landmarks[57], landmarks[66]);

  const widthRatio = ratioScore(mouthWidth / noseWidth, 1.5);
  const lipRatio = ratioScore(upperLipHeight / lowerLipHeight, 0.8);

  return (widthRatio + lipRatio) / 2;
}

export function calculateContourScore(landmarks: Point[]): number {
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

export function calculateFaceScore(landmarks: Point[]): ScoreDetails {
  const faceWidth = distance(landmarks[0], landmarks[16]);

  return {
    golden_ratio: Math.round(calculateGoldenRatio(landmarks)),
    eyes: Math.round(calculateEyeScore(landmarks)),
    nose: Math.round(calculateNoseScore(landmarks)),
    mouth: Math.round(calculateMouthScore(landmarks)),
    contour: Math.round(calculateContourScore(landmarks)),
  };
}

export function totalScore(details: ScoreDetails): number {
  const score =
    details.golden_ratio * 0.35 +
    details.eyes * 0.15 +
    details.nose * 0.15 +
    details.mouth * 0.15 +
    details.contour * 0.20;
  return Math.round(score * 10) / 10;
}

/**
 * 年齢を考慮したスコア補正
 * 20代前半をピーク(+5)とし、離れるほど減点
 */
export function ageAdjustedScore(baseScore: number, age: number): number {
  const peakAge = 23;
  const diff = Math.abs(age - peakAge);
  let adjustment: number;

  if (diff <= 3) {
    adjustment = 5 - diff;        // 20-26歳: +2 ~ +5
  } else if (diff <= 10) {
    adjustment = -(diff - 3) * 0.8; // 13-19, 27-33歳: -0.8 ~ -5.6
  } else {
    adjustment = -5.6 - (diff - 10) * 1.2; // それ以上: さらに減点
  }

  return Math.round((baseScore + adjustment) * 10) / 10;
}
