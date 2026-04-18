interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Landmark {
  x: number;
  y: number;
}

export interface BodyProportionEstimate {
  ratio: number;
  score: number;
  confidence: 'medium' | 'low';
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function estimateBodyProportion(
  box: FaceBox,
  landmarks: Landmark[] | undefined,
  canvas: HTMLCanvasElement,
): BodyProportionEstimate | null {
  if (box.width <= 0 || box.height <= 0 || canvas.height <= 0) {
    return null;
  }

  const hasLandmarks = !!landmarks && landmarks.length >= 28;
  const chinY = hasLandmarks ? landmarks![8].y : box.y + box.height;
  const browY = hasLandmarks ? (landmarks![19].y + landmarks![24].y) / 2 : box.y;
  const chinToBrow = Math.max(1, chinY - browY);

  const estimatedHeadHeight = Math.max(box.height * 1.15, chinToBrow * 1.8);
  const estimatedHeadTop = Math.max(0, browY - chinToBrow * 0.9);
  const lowerVisibleHeight = canvas.height - chinY;
  const estimatedVisibleBodyHeight = canvas.height * 0.96 - estimatedHeadTop;
  const ratio = estimatedVisibleBodyHeight / estimatedHeadHeight;

  if (
    estimatedHeadHeight < 28 ||
    lowerVisibleHeight < estimatedHeadHeight * 1.5 ||
    ratio < 3.0
  ) {
    return null;
  }

  const scoringRatio = Math.min(ratio, 8.5);
  const score = clamp(100 - Math.abs(scoringRatio - 7.5) * 10, 35, 100);
  const confidence =
    lowerVisibleHeight >= estimatedHeadHeight * 3.0 ? 'medium' : 'low';

  return {
    ratio: round1(ratio),
    score: round1(score),
    confidence,
  };
}
