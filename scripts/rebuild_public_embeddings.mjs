import * as faceapi from 'face-api.js';
import canvas from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'web', 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const MODEL_DIR = path.join(PUBLIC_DIR, 'models');
const CELEBRITIES_JSON = path.join(DATA_DIR, 'celebrities.json');
const EMBEDDINGS_BIN = path.join(DATA_DIR, 'embeddings.bin');
const EMBEDDINGS_INDEX = path.join(DATA_DIR, 'embeddings_index.json');
const REPORT_JSON = path.join(__dirname, 'embedding_rebuild_report.json');
const DIM = 128;

const { Canvas, Image, ImageData, loadImage, createCanvas } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

function loadCelebrities() {
  return JSON.parse(fs.readFileSync(CELEBRITIES_JSON, 'utf-8'));
}

function writeBinaryEmbeddings(embeddings) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(embeddings.length, 0);
  header.writeUInt32LE(DIM, 4);

  const payload = Buffer.alloc(embeddings.length * DIM * 4);
  let offset = 0;
  for (const embedding of embeddings) {
    if (!Array.isArray(embedding) || embedding.length !== DIM) {
      throw new Error(`Invalid embedding length: expected ${DIM}`);
    }
    for (const value of embedding) {
      payload.writeFloatLE(Number(value), offset);
      offset += 4;
    }
  }

  fs.writeFileSync(EMBEDDINGS_BIN, Buffer.concat([header, payload]));
}

function writeEmbeddingIndex(celebrities) {
  const index = {};
  celebrities.forEach((celebrity, i) => {
    index[celebrity.id] = {
      index: i,
      name: celebrity.name,
    };
  });
  fs.writeFileSync(EMBEDDINGS_INDEX, JSON.stringify(index, null, 2), 'utf-8');
}

async function detectDescriptor(thumbnailPath) {
  const img = await loadImage(thumbnailPath);
  const cvs = createCanvas(img.width, img.height);
  const ctx = cvs.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const detection = await faceapi
    .detectSingleFace(cvs)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) return null;
  return Array.from(detection.descriptor);
}

async function main() {
  console.log('Loading face-api.js models...');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);

  const celebrities = loadCelebrities();
  const embeddings = [];
  const failures = [];

  for (const [index, celebrity] of celebrities.entries()) {
    const thumbPath = path.join(PUBLIC_DIR, celebrity.thumbnail);
    process.stdout.write(`[${index + 1}/${celebrities.length}] ${celebrity.name} ... `);

    try {
      const descriptor = await detectDescriptor(thumbPath);
      if (!descriptor) {
        failures.push({
          name: celebrity.name,
          id: celebrity.id,
          thumbnail: celebrity.thumbnail,
          reason: 'no_face_detected',
        });
        embeddings.push(new Array(DIM).fill(0));
        console.log('no face');
        continue;
      }

      embeddings.push(descriptor);
      console.log('ok');
    } catch (error) {
      failures.push({
        name: celebrity.name,
        id: celebrity.id,
        thumbnail: celebrity.thumbnail,
        reason: error instanceof Error ? error.message : String(error),
      });
      embeddings.push(new Array(DIM).fill(0));
      console.log('error');
    }
  }

  writeBinaryEmbeddings(embeddings);
  writeEmbeddingIndex(celebrities);

  const report = {
    count: celebrities.length,
    success: celebrities.length - failures.length,
    failed: failures.length,
    failures,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf-8');

  console.log(
    `Done. success=${report.success} failed=${report.failed} bin=${EMBEDDINGS_BIN} index=${EMBEDDINGS_INDEX}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
