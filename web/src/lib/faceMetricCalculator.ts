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
  const jawLine = landmarks.slice(0, 17);
  let smoothness = 0;

  for (let i = 1; i < jawLine.length - 1; i++) {
    const expected = midpoint(jawLine[i - 1], jawLine[i + 1]);
    const deviation = distance(jawLine[i], expected);
    const segmentLength = distance(jawLine[i - 1], jawLine[i + 1]);
    smoothness += segmentLength > 0 ? deviation / segmentLength : 0;
  }

  const averageDeviation = smoothness / (jawLine.length - 2);
  return clamp((1 - averageDeviation * 8) * 100);
}

export function calculateFaceDetails(landmarks: Point[]): ScoreDetails {
  return {
    golden_ratio: Math.round(calculateGoldenRatio(landmarks)),
    eyes: Math.round(calculateEyeScore(landmarks)),
    nose: Math.round(calculateNoseScore(landmarks)),
    mouth: Math.round(calculateMouthScore(landmarks)),
    contour: Math.round(calculateContourScore(landmarks)),
  };
}
