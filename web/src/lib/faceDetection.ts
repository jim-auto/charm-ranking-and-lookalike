import * as faceapi from 'face-api.js';

let modelsLoaded = false;

export async function loadModels(modelPath: string): Promise<void> {
  if (modelsLoaded) return;

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
  const detection = await faceapi
    .detectSingleFace(input)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) return null;

  const landmarks = detection.landmarks.positions.map((p) => ({
    x: p.x,
    y: p.y,
  }));

  const box = detection.detection.box;

  return {
    landmarks,
    embedding: Array.from(detection.descriptor),
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}
