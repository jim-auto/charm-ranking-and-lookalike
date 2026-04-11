let modelsLoaded = false;
let faceApiPromise: Promise<typeof import('face-api.js')> | null = null;
const NORMALIZED_EMBEDDING_SIZE = 200;
const EMBEDDING_PADDING_RATIO = 0.3;

async function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = import('face-api.js');
  }
  return faceApiPromise;
}

function extractNormalizedFaceCanvas(
  input: HTMLImageElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  const sourceWidth = input instanceof HTMLCanvasElement ? input.width : input.naturalWidth || input.width;
  const sourceHeight =
    input instanceof HTMLCanvasElement ? input.height : input.naturalHeight || input.height;
  const padding = Math.max(box.width, box.height) * EMBEDDING_PADDING_RATIO;
  const cropX = Math.max(0, Math.floor(box.x - padding));
  const cropY = Math.max(0, Math.floor(box.y - padding));
  const cropWidth = Math.max(
    1,
    Math.min(sourceWidth - cropX, Math.floor(box.width + padding * 2)),
  );
  const cropHeight = Math.max(
    1,
    Math.min(sourceHeight - cropY, Math.floor(box.height + padding * 2)),
  );

  const canvas = document.createElement('canvas');
  canvas.width = NORMALIZED_EMBEDDING_SIZE;
  canvas.height = NORMALIZED_EMBEDDING_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(
    input,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    NORMALIZED_EMBEDDING_SIZE,
    NORMALIZED_EMBEDDING_SIZE,
  );

  return canvas;
}

export async function loadModels(modelPath: string): Promise<void> {
  if (modelsLoaded) return;

  const faceapi = await loadFaceApi();
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
    faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
  ]);

  modelsLoaded = true;
}

export interface DetectionResult {
  landmarks: { x: number; y: number }[];
  embedding: number[];
  box: { x: number; y: number; width: number; height: number };
}

export async function detectFace(
  input: HTMLImageElement | HTMLCanvasElement,
): Promise<DetectionResult | null> {
  const faceapi = await loadFaceApi();
  const detection = await faceapi.detectSingleFace(input).withFaceLandmarks();

  if (!detection) return null;

  const landmarks = detection.landmarks.positions.map((p) => ({
    x: p.x,
    y: p.y,
  }));

  const box = detection.detection.box;
  const normalizedFace = extractNormalizedFaceCanvas(input, box);
  const computedDescriptor = await faceapi.computeFaceDescriptor(normalizedFace);
  const descriptor = Array.isArray(computedDescriptor)
    ? computedDescriptor[0]
    : computedDescriptor;
  if (!descriptor) return null;

  return {
    landmarks,
    embedding: Array.from(descriptor),
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}
