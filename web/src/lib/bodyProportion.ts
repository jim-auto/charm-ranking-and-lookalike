interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
  canvas: HTMLCanvasElement,
): BodyProportionEstimate | null {
  if (box.width <= 0 || box.height <= 0 || canvas.height <= 0) {
    return null;
  }

  const estimatedHeadHeight = box.height * 1.12;
  const estimatedHeadTop = Math.max(0, box.y - box.height * 0.08);
  const lowerVisibleHeight = canvas.height - (box.y + box.height);
  const estimatedVisibleBodyHeight = canvas.height * 0.96 - estimatedHeadTop;
  const ratio = estimatedVisibleBodyHeight / estimatedHeadHeight;

  if (
    estimatedHeadHeight < 24 ||
    lowerVisibleHeight < estimatedHeadHeight * 2.8 ||
    ratio < 4.2
  ) {
    return null;
  }

  const score = clamp(100 - Math.abs(ratio - 7.5) * 12, 35, 100);
  const confidence = lowerVisibleHeight >= estimatedHeadHeight * 4.2 ? 'medium' : 'low';

  return {
    ratio: round1(ratio),
    score: round1(score),
    confidence,
  };
}
