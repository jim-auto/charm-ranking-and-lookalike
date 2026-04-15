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
const EMBEDDING_VARIANTS_JSON = path.join(DATA_DIR, 'embedding_variants.json');
const REPORT_JSON = path.join(__dirname, 'embedding_rebuild_report.json');
const INPUT_IMAGES_DIR = path.join(__dirname, 'input_images');
const DIM = 128;
const NORMALIZED_EMBEDDING_SIZE = 200;
const EMBEDDING_PADDING_RATIO = 0.3;
const UPSCALE_FALLBACK_THRESHOLD = 240;

const { Canvas, Image, ImageData, loadImage } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

function loadCelebrities() {
  return JSON.parse(fs.readFileSync(CELEBRITIES_JSON, 'utf-8'));
}

function loadExistingEmbeddings() {
  if (!fs.existsSync(EMBEDDINGS_BIN) || !fs.existsSync(EMBEDDINGS_INDEX)) {
    return null;
  }

  const index = JSON.parse(fs.readFileSync(EMBEDDINGS_INDEX, 'utf-8'));
  const buffer = fs.readFileSync(EMBEDDINGS_BIN);
  if (buffer.length < 8) {
    return null;
  }

  const count = buffer.readUInt32LE(0);
  const dimension = buffer.readUInt32LE(4);
  if (dimension !== DIM) {
    return null;
  }

  const values = new Float32Array(count * dimension);
  for (let i = 0; i < count * dimension; i++) {
    values[i] = buffer.readFloatLE(8 + i * 4);
  }
  return { index, dimension, values };
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

function loadExistingVariants() {
  if (!fs.existsSync(EMBEDDING_VARIANTS_JSON)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(EMBEDDING_VARIANTS_JSON, 'utf-8'));
}

function writeEmbeddingVariants(variants) {
  fs.writeFileSync(EMBEDDING_VARIANTS_JSON, JSON.stringify(variants, null, 2), 'utf-8');
}

function getExistingEmbedding(store, celebrityId) {
  const entry = store?.index?.[celebrityId];
  if (!entry) return null;
  const start = entry.index * store.dimension;
  const end = start + store.dimension;
  if (start < 0 || end > store.values.length) {
    return null;
  }
  return Array.from(store.values.subarray(start, end));
}

function extractNormalizedFaceCanvas(image, box) {
  const output = canvas.createCanvas(NORMALIZED_EMBEDDING_SIZE, NORMALIZED_EMBEDDING_SIZE);
  const ctx = output.getContext('2d');
  const padding = Math.max(box.width, box.height) * EMBEDDING_PADDING_RATIO;
  const cropX = Math.max(0, Math.floor(box.x - padding));
  const cropY = Math.max(0, Math.floor(box.y - padding));
  const cropWidth = Math.max(
    1,
    Math.min(image.width - cropX, Math.floor(box.width + padding * 2)),
  );
  const cropHeight = Math.max(
    1,
    Math.min(image.height - cropY, Math.floor(box.height + padding * 2)),
  );

  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    NORMALIZED_EMBEDDING_SIZE,
    NORMALIZED_EMBEDDING_SIZE,
  );
  return output;
}

function buildDetectionAttempts(image) {
  const attempts = [{ source: image, scale: 1, offsetX: 0, offsetY: 0 }];
  const minDimension = Math.min(image.width, image.height);
  if (minDimension > UPSCALE_FALLBACK_THRESHOLD) {
    return attempts;
  }

  const scale = minDimension <= 160 ? 3 : 2;
  const enlarged = canvas.createCanvas(image.width * scale, image.height * scale);
  const enlargedCtx = enlarged.getContext('2d');
  enlargedCtx.drawImage(image, 0, 0, enlarged.width, enlarged.height);
  attempts.push({ source: enlarged, scale, offsetX: 0, offsetY: 0 });

  const padX = Math.round(enlarged.width * 0.18);
  const padY = Math.round(enlarged.height * 0.18);
  const padded = canvas.createCanvas(enlarged.width + padX * 2, enlarged.height + padY * 2);
  const paddedCtx = padded.getContext('2d');
  paddedCtx.fillStyle = '#18181c';
  paddedCtx.fillRect(0, 0, padded.width, padded.height);
  paddedCtx.drawImage(enlarged, padX, padY);
  attempts.push({ source: padded, scale, offsetX: padX, offsetY: padY });

  return attempts;
}

async function computeDescriptor(imagePath, sourceKind = 'thumbnail') {
  const img = await loadImage(fs.readFileSync(imagePath));

  let detection = null;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  for (const attempt of buildDetectionAttempts(img)) {
    detection = await faceapi.detectSingleFace(attempt.source).withFaceLandmarks();
    if (detection) {
      scale = attempt.scale;
      offsetX = attempt.offsetX;
      offsetY = attempt.offsetY;
      break;
    }
  }

  let descriptorInput = img;
  let mode = `full_${sourceKind}`;

  if (detection) {
    const box = {
      x: (detection.detection.box.x - offsetX) / scale,
      y: (detection.detection.box.y - offsetY) / scale,
      width: detection.detection.box.width / scale,
      height: detection.detection.box.height / scale,
    };
    descriptorInput = extractNormalizedFaceCanvas(img, box);
    mode = `normalized_${sourceKind}_crop`;
  }

  const computedDescriptor = await faceapi.computeFaceDescriptor(descriptorInput);
  const descriptor = Array.isArray(computedDescriptor)
    ? computedDescriptor[0]
    : computedDescriptor;
  if (!(descriptor instanceof Float32Array) || descriptor.length !== DIM) {
    return null;
  }
  return {
    mode,
    embedding: Array.from(descriptor),
  };
}

function parseArgs(argv) {
  let idsFile = null;
  let inputPhotoIdsFile = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ids-file') {
      idsFile = argv[i + 1] ? path.resolve(argv[i + 1]) : null;
      i += 1;
    } else if (argv[i] === '--input-photo-ids-file') {
      inputPhotoIdsFile = argv[i + 1] ? path.resolve(argv[i + 1]) : null;
      i += 1;
    }
  }
  return { idsFile, inputPhotoIdsFile };
}

function loadSelectedKeys(idsFile) {
  if (!idsFile) return null;
  const lines = fs
    .readFileSync(idsFile, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return new Set(lines);
}

function shouldUseInputPhotoVariant(celebrity, inputPhotoKeys) {
  return Boolean(
    inputPhotoKeys &&
      (inputPhotoKeys.has(celebrity.id) || inputPhotoKeys.has(celebrity.name)),
  );
}

function getInputPhotoPath(celebrity) {
  return path.join(INPUT_IMAGES_DIR, celebrity.name, 'photo.jpg');
}

async function main() {
  const { idsFile, inputPhotoIdsFile } = parseArgs(process.argv.slice(2));
  const selectedKeys = loadSelectedKeys(idsFile);
  const inputPhotoKeys = loadSelectedKeys(inputPhotoIdsFile);
  console.log('Loading face-api.js models...');
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR),
    faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR),
    faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR),
  ]);

  const celebrities = loadCelebrities();
  const existingStore = loadExistingEmbeddings();
  const existingVariants = loadExistingVariants();
  const embeddings = [];
  const variants = {};
  const failures = [];
  const modeCounts = {
    normalized_thumbnail_crop: 0,
    full_thumbnail: 0,
    reused_existing: 0,
  };
  const variantModeCounts = {
    normalized_input_photo_crop: 0,
    full_input_photo: 0,
    reused_existing: 0,
  };

  for (const [index, celebrity] of celebrities.entries()) {
    const shouldRebuild =
      !selectedKeys ||
      selectedKeys.has(celebrity.id) ||
      selectedKeys.has(celebrity.name);
    const existingVariantEntries = Array.isArray(existingVariants[celebrity.id])
      ? existingVariants[celebrity.id]
      : [];
    if (!shouldRebuild) {
      const existingEmbedding = getExistingEmbedding(existingStore, celebrity.id);
      if (!existingEmbedding || existingEmbedding.length !== DIM) {
        failures.push({
          name: celebrity.name,
          id: celebrity.id,
          thumbnail: celebrity.thumbnail,
          reason: 'missing_existing_embedding',
        });
        embeddings.push(new Array(DIM).fill(0));
      } else {
        embeddings.push(existingEmbedding);
        modeCounts.reused_existing += 1;
        if (existingVariantEntries.length > 0) {
          variants[celebrity.id] = existingVariantEntries;
          variantModeCounts.reused_existing += existingVariantEntries.length;
        }
      }
      console.log(
        `[${index + 1}/${celebrities.length}] ${celebrity.name} ... reuse`,
      );
      continue;
    }

    process.stdout.write(`[${index + 1}/${celebrities.length}] ${celebrity.name} ... `);

    try {
      const thumbPath = path.join(PUBLIC_DIR, celebrity.thumbnail);
      const mainResult = await computeDescriptor(thumbPath, 'thumbnail');
      if (!mainResult) {
        failures.push({
          name: celebrity.name,
          id: celebrity.id,
          thumbnail: celebrity.thumbnail,
          source: 'thumbnail',
          reason: 'invalid_descriptor',
        });
        embeddings.push(new Array(DIM).fill(0));
        console.log('invalid');
        continue;
      }

      embeddings.push(mainResult.embedding);
      modeCounts[mainResult.mode] = (modeCounts[mainResult.mode] ?? 0) + 1;

      let status = mainResult.mode.includes('crop') ? 'thumb:crop' : 'thumb:full';
      if (shouldUseInputPhotoVariant(celebrity, inputPhotoKeys)) {
        const inputPhotoPath = getInputPhotoPath(celebrity);
        const variantResult = await computeDescriptor(inputPhotoPath, 'input_photo');
        if (!variantResult) {
          failures.push({
            name: celebrity.name,
            id: celebrity.id,
            thumbnail: celebrity.thumbnail,
            source: 'input_photo',
            reason: 'invalid_descriptor',
          });
        } else {
          variants[celebrity.id] = [
            {
              source: 'input_photo',
              embedding: variantResult.embedding,
            },
          ];
          variantModeCounts[variantResult.mode] =
            (variantModeCounts[variantResult.mode] ?? 0) + 1;
          status += variantResult.mode.includes('crop') ? ' + input:crop' : ' + input:full';
        }
      } else if (existingVariantEntries.length > 0) {
        variants[celebrity.id] = existingVariantEntries;
        variantModeCounts.reused_existing += existingVariantEntries.length;
        status += ' + variant:reuse';
      }

      console.log(status);
    } catch (error) {
      failures.push({
        name: celebrity.name,
        id: celebrity.id,
        thumbnail: celebrity.thumbnail,
        source: shouldUseInputPhotoVariant(celebrity, inputPhotoKeys)
          ? 'thumbnail_or_input_photo'
          : 'thumbnail',
        reason: error instanceof Error ? error.message : String(error),
      });
      embeddings.push(new Array(DIM).fill(0));
      console.log('error');
    }
  }

  writeBinaryEmbeddings(embeddings);
  writeEmbeddingIndex(celebrities);
  writeEmbeddingVariants(variants);

  const report = {
    count: celebrities.length,
    success: celebrities.length - failures.length,
    failed: failures.length,
    partial: Boolean(selectedKeys),
    selectedCount: selectedKeys?.size ?? celebrities.length,
    modeCounts,
    variantCount: Object.keys(variants).length,
    variantModeCounts,
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
