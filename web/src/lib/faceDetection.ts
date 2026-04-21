let modelsLoaded = false;
let faceApiPromise: Promise<typeof import('face-api.js')> | null = null;
let tensorBackendPromise: Promise<void> | null = null;
const NORMALIZED_EMBEDDING_SIZE = 200;
const EMBEDDING_PADDING_RATIO = 0.3;
const UPSCALE_FALLBACK_THRESHOLD = 240;
const SMALL_FACE_ALTERNATE_AREA_THRESHOLD = 12;
const SMALL_FACE_ALTERNATE_MIN_BOX = 130;

async function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = import('face-api.js');
  }
  return faceApiPromise;
}

async function ensureTensorBackend(faceapi: typeof import('face-api.js')): Promise<void> {
  if (!tensorBackendPromise) {
    tensorBackendPromise = (async () => {
      const tf = faceapi.tf;
      if (tf.getBackend() !== 'cpu') {
        const backendReady = await tf.setBackend('cpu');
        if (!backendReady) {
          throw new Error('TensorFlow CPU backend is unavailable.');
        }
      }
      await tf.ready();
    })().catch((error) => {
      tensorBackendPromise = null;
      throw error;
    });
  }

  return tensorBackendPromise;
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

function getInputDimensions(input: HTMLImageElement | HTMLCanvasElement) {
  return {
    width: input instanceof HTMLCanvasElement ? input.width : input.naturalWidth || input.width,
    height: input instanceof HTMLCanvasElement ? input.height : input.naturalHeight || input.height,
  };
}

function createScaledCanvas(
  input: HTMLImageElement | HTMLCanvasElement,
  scale: number,
): HTMLCanvasElement {
  const { width, height } = getInputDimensions(input);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createPaddedCanvas(
  input: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = input.width + offsetX * 2;
  canvas.height = input.height + offsetY * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#18181c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(input, offsetX, offsetY);
  return canvas;
}

function calculateFaceAreaRatio(
  input: HTMLImageElement | HTMLCanvasElement,
  box: { width: number; height: number },
): number {
  const { width, height } = getInputDimensions(input);
  return ((box.width * box.height) / Math.max(width * height, 1)) * 100;
}

async function computeEmbeddingFromBox(
  faceapi: typeof import('face-api.js'),
  input: HTMLImageElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
): Promise<number[] | null> {
  const normalizedFace = extractNormalizedFaceCanvas(input, box);
  const computedDescriptor = await faceapi.computeFaceDescriptor(normalizedFace);
  const descriptor = Array.isArray(computedDescriptor)
    ? computedDescriptor[0]
    : computedDescriptor;
  return descriptor ? Array.from(descriptor) : null;
}

function blendEmbeddings(embeddings: number[][]): number[] | null {
  if (embeddings.length === 0) {
    return null;
  }

  const dimension = embeddings[0]?.length ?? 0;
  if (dimension === 0 || embeddings.some((embedding) => embedding.length !== dimension)) {
    return null;
  }

  const blended = new Array<number>(dimension).fill(0);
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
  if (safeNorm === 0) {
    return null;
  }

  for (let i = 0; i < dimension; i++) {
    blended[i] /= safeNorm;
  }

  return blended;
}

async function detectMappedFace(
  faceapi: typeof import('face-api.js'),
  source: HTMLImageElement | HTMLCanvasElement,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
): Promise<{
  landmarks: { x: number; y: number }[];
  box: { x: number; y: number; width: number; height: number };
} | null> {
  const detection = await faceapi.detectSingleFace(source).withFaceLandmarks();
  if (!detection) {
    return null;
  }

  return {
    landmarks: detection.landmarks.positions.map((p) => ({
      x: (p.x - offsetX) / scale,
      y: (p.y - offsetY) / scale,
    })),
    box: {
      x: (detection.detection.box.x - offsetX) / scale,
      y: (detection.detection.box.y - offsetY) / scale,
      width: detection.detection.box.width / scale,
      height: detection.detection.box.height / scale,
    },
  };
}

async function buildAlternateEmbeddings(
  faceapi: typeof import('face-api.js'),
  input: HTMLImageElement | HTMLCanvasElement,
  primaryBox: { x: number; y: number; width: number; height: number },
): Promise<number[][]> {
  const faceAreaRatio = calculateFaceAreaRatio(input, primaryBox);
  if (faceAreaRatio > SMALL_FACE_ALTERNATE_AREA_THRESHOLD) {
    return [];
  }

  const alternateScale =
    Math.min(primaryBox.width, primaryBox.height) < SMALL_FACE_ALTERNATE_MIN_BOX ? 3 : 2;
  const scaledCanvas = createScaledCanvas(input, alternateScale);
  const offsetX = Math.round(scaledCanvas.width * 0.18);
  const offsetY = Math.round(scaledCanvas.height * 0.18);
  const paddedCanvas = createPaddedCanvas(scaledCanvas, offsetX, offsetY);
  const alternateDetection = await detectMappedFace(
    faceapi,
    paddedCanvas,
    alternateScale,
    offsetX,
    offsetY,
  );

  if (!alternateDetection) {
    return [];
  }

  const alternateEmbedding = await computeEmbeddingFromBox(
    faceapi,
    input,
    alternateDetection.box,
  );
  return alternateEmbedding ? [alternateEmbedding] : [];
}

export async function loadModels(modelPath: string): Promise<void> {
  if (modelsLoaded) return;

  const faceapi = await loadFaceApi();
  await ensureTensorBackend(faceapi);
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
  alternateEmbeddings?: number[][];
  box: { x: number; y: number; width: number; height: number };
}

export async function detectFace(
  input: HTMLImageElement | HTMLCanvasElement,
): Promise<DetectionResult | null> {
  const faceapi = await loadFaceApi();
  await ensureTensorBackend(faceapi);

  let detection = await detectMappedFace(faceapi, input);
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  const { width, height } = getInputDimensions(input);
  if (!detection && Math.min(width, height) <= UPSCALE_FALLBACK_THRESHOLD) {
    scale = Math.min(width, height) <= 160 ? 3 : 2;
    const scaledCanvas = createScaledCanvas(input, scale);
    detection = await detectMappedFace(faceapi, scaledCanvas, scale);
    if (!detection) {
      offsetX = Math.round(scaledCanvas.width * 0.18);
      offsetY = Math.round(scaledCanvas.height * 0.18);
      detection = await detectMappedFace(
        faceapi,
        createPaddedCanvas(scaledCanvas, offsetX, offsetY),
        scale,
        offsetX,
        offsetY,
      );
    }
  }

  if (!detection) return null;

  const descriptor = await computeEmbeddingFromBox(faceapi, input, detection.box);
  if (!descriptor) return null;

  const alternateEmbeddings =
    scale === 1 && offsetX === 0 && offsetY === 0
      ? await buildAlternateEmbeddings(faceapi, input, detection.box)
      : [];
  const blendedEmbedding =
    alternateEmbeddings.length > 0 ? blendEmbeddings([descriptor, ...alternateEmbeddings]) : null;
  const queryAlternates = blendedEmbedding
    ? [...alternateEmbeddings, blendedEmbedding]
    : alternateEmbeddings;

  return {
    landmarks: detection.landmarks,
    embedding: descriptor,
    alternateEmbeddings: queryAlternates.length > 0 ? queryAlternates : undefined,
    box: detection.box,
  };
}
