interface Point {
  x: number;
  y: number;
}

interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface PhotoQualityAssessment {
  overallScore: number;
  frontalScore: number;
  sharpnessScore: number;
  cropScore: number;
  faceAreaRatio: number;
  yawScore: number;
  pitchScore: number;
  rollDegrees: number;
  diagnosisReady: boolean;
  retryRecommended: boolean;
  symmetryReliable: boolean;
  contourReliable: boolean;
  symmetryConfidence: ConfidenceLevel;
  contourConfidence: ConfidenceLevel;
  blockingReasons: string[];
  notes: string[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function averagePoint(points: Point[]): Point {
  const total = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function shapeRatioScore(actual: number, ideal: number, factor = 2): number {
  if (actual <= 0 || ideal <= 0) return 0;
  const deviation = Math.abs(actual - ideal) / ideal;
  return clamp((1 - deviation * factor) * 100);
}

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

function getRollDegrees(landmarks: Point[]): number {
  const leftEye = midpoint(landmarks[36], landmarks[39]);
  const rightEye = midpoint(landmarks[42], landmarks[45]);
  return (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI;
}

function rotateLandmarks(landmarks: Point[]): Point[] {
  const leftEye = midpoint(landmarks[36], landmarks[39]);
  const rightEye = midpoint(landmarks[42], landmarks[45]);
  const eyeCenter = midpoint(leftEye, rightEye);
  const roll = -Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  return landmarks.map((point) => rotatePoint(point, eyeCenter, roll));
}

function calculateYawScore(rotated: Point[]): number {
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

function calculatePitchScore(rotated: Point[]): number {
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

function calculateCropScore(box: FaceBox, canvas: HTMLCanvasElement): number {
  const leftMargin = box.x / box.width;
  const rightMargin = (canvas.width - (box.x + box.width)) / box.width;
  const topMargin = box.y / box.height;
  const bottomMargin = (canvas.height - (box.y + box.height)) / box.height;
  const minMargin = Math.min(leftMargin, rightMargin, topMargin, bottomMargin);
  const marginScore = clamp(((minMargin - 0.02) / 0.12) * 100);

  const areaRatio = (box.width * box.height) / Math.max(canvas.width * canvas.height, 1);
  const sizeScore = shapeRatioScore(areaRatio, 0.18, 0.9);

  return round1(marginScore * 0.7 + sizeScore * 0.3);
}

function calculateSharpnessScore(box: FaceBox, canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 50;

  const insetX = box.width * 0.15;
  const insetY = box.height * 0.15;
  const x = Math.max(0, Math.floor(box.x + insetX));
  const y = Math.max(0, Math.floor(box.y + insetY));
  const width = Math.max(16, Math.floor(box.width - insetX * 2));
  const height = Math.max(16, Math.floor(box.height - insetY * 2));
  const safeWidth = Math.min(width, canvas.width - x);
  const safeHeight = Math.min(height, canvas.height - y);

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
      const laplacian =
        Math.abs(
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

function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 78) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

export function calculatePhotoQuality(
  landmarks: Point[],
  box: FaceBox,
  canvas: HTMLCanvasElement,
): PhotoQualityAssessment {
  const rollDegrees = round1(getRollDegrees(landmarks));
  const rollScore = round1(clamp(100 - (Math.abs(rollDegrees) / 16) * 100));
  const rotated = rotateLandmarks(landmarks);
  const yawScore = calculateYawScore(rotated);
  const pitchScore = calculatePitchScore(rotated);
  const frontalScore = round1(rollScore * 0.2 + yawScore * 0.5 + pitchScore * 0.3);
  const cropScore = calculateCropScore(box, canvas);
  const sharpnessScore = calculateSharpnessScore(box, canvas);
  const faceAreaRatio = round1(
    ((box.width * box.height) / Math.max(canvas.width * canvas.height, 1)) * 100,
  );
  const overallScore = round1(frontalScore * 0.55 + sharpnessScore * 0.25 + cropScore * 0.2);

  const symmetrySupport = round1(frontalScore * 0.7 + sharpnessScore * 0.15 + cropScore * 0.15);
  const contourSupport = round1(frontalScore * 0.45 + cropScore * 0.35 + sharpnessScore * 0.2);
  const symmetryReliable =
    frontalScore >= 78 &&
    yawScore >= 68 &&
    pitchScore >= 58 &&
    sharpnessScore >= 22 &&
    cropScore >= 35;
  const contourReliable = frontalScore >= 58 && cropScore >= 30;

  const blockingReasons: string[] = [];
  if (pitchScore < 18) {
    blockingReasons.push('顎の上げ下げが大きく、縦バランスが崩れています。');
  }
  if (Math.abs(rollDegrees) > 22) {
    blockingReasons.push('顔の傾きが大きすぎます。');
  }
  if (yawScore < 5 && faceAreaRatio < 5) {
    blockingReasons.push('横向きが強く、顔の中心位置を安定して取りにくいです。');
  }
  if (frontalScore < 20 && cropScore < 40) {
    blockingReasons.push('正面度が足りず、安定して診断しにくいです。');
  }
  if (faceAreaRatio < 4) {
    blockingReasons.push('顔が小さすぎて、細部を安定して取りにくいです。');
  }
  if (cropScore < 18) {
    blockingReasons.push('顔が小さすぎるか、輪郭が切れています。');
  }
  if (sharpnessScore < 5) {
    blockingReasons.push('写真がぼけすぎています。');
  }

  const diagnosisReady = blockingReasons.length === 0;
  const retryRecommended =
    !diagnosisReady ||
    overallScore < 55 ||
    frontalScore < 60 ||
    yawScore < 45 ||
    pitchScore < 35 ||
    cropScore < 30 ||
    sharpnessScore < 20;

  const notes: string[] = [];
  if (yawScore < 68) notes.push('横向きが強めです。正面の写真だと左右対称を見やすくなります。');
  if (pitchScore < 58) notes.push('顎の上げ下げが強めです。目線の高さで撮ると安定します。');
  if (Math.abs(rollDegrees) > 9) notes.push('顔の傾きが大きめです。まっすぐに近い写真だと見やすいです。');
  if (cropScore < 35) notes.push('顔まわりが詰まり気味で、輪郭が取りにくいです。');
  if (faceAreaRatio < 10) notes.push('顔がやや小さめです。もう少し近い写真だと安定します。');
  if (sharpnessScore < 22) notes.push('少しぼけています。明るい場所だと安定します。');
  if (notes.length === 0) notes.push('この写真ならかなり見やすいです。');

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
    symmetryReliable,
    contourReliable,
    symmetryConfidence: getConfidenceLevel(symmetrySupport),
    contourConfidence: getConfidenceLevel(contourSupport),
    blockingReasons,
    notes,
  };
}
