const CANVAS_PROBE_COLORS = [
  [12, 34, 56],
  [201, 123, 45],
] as const;

function getCanvasReadbackIssue(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_PROBE_COLORS.length;
  canvas.height = 1;
  canvas.dataset.diagnosisCompatibilityProbe = 'true';
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return 'Canvas 2D context is unavailable.';
  }

  CANVAS_PROBE_COLORS.forEach(([red, green, blue], index) => {
    ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    ctx.fillRect(index, 0, 1, 1);
  });

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, CANVAS_PROBE_COLORS.length, 1).data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Canvas pixel readback is blocked. ${message}`;
  }

  const tolerance = 1;
  const isModified = CANVAS_PROBE_COLORS.some(([red, green, blue], index) => {
    const offset = index * 4;
    return (
      Math.abs(data[offset] - red) > tolerance ||
      Math.abs(data[offset + 1] - green) > tolerance ||
      Math.abs(data[offset + 2] - blue) > tolerance ||
      data[offset + 3] !== 255
    );
  });

  return isModified ? 'Canvas pixel readback is modified by privacy protection.' : null;
}

export function isProbablyBraveBrowser(): boolean {
  return typeof navigator !== 'undefined' && 'brave' in navigator;
}

export function assertDiagnosisBrowserSupport(): void {
  const issue = getCanvasReadbackIssue();
  if (issue) {
    throw new Error(issue);
  }
}

export function getDiagnosisCompatibilityMessage(error?: unknown): string {
  const detail = error instanceof Error ? error.message : error ? String(error) : '';
  const bravePrefix = isProbablyBraveBrowser() ? 'Braveの' : 'ブラウザの';
  return `${bravePrefix}プライバシー保護がAI診断に必要な画像解析を制限している可能性があります。このサイトのBrave Shieldsをオフ、または「フィンガープリント防止」を標準/許可にしてから再読み込みしてください。写真はサーバーに送られず、ブラウザ内だけで処理されます。${detail ? ` (${detail})` : ''}`;
}

export function getDiagnosisRuntimeErrorMessage(error: unknown): string | null {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const lowerMessage = message.toLowerCase();
  const looksLikeBrowserRestriction = [
    'backend',
    'blocked',
    'canvas',
    'denied',
    'fingerprint',
    'getimagedata',
    'readback',
    'securityerror',
    'tensorflow',
    'tfjs',
    'webgl',
  ].some((token) => lowerMessage.includes(token));

  return isProbablyBraveBrowser() || looksLikeBrowserRestriction
    ? getDiagnosisCompatibilityMessage(error)
    : null;
}
