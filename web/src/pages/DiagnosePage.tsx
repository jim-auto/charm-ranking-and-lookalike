import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Celebrity, ScoreDetails } from '../types/celebrity';
import { loadModels, detectFace } from '../lib/faceDetection';
import {
  type EmbeddingStore,
  findSimilarCelebritiesByAnyEmbedding,
  loadEmbeddingStore,
} from '../lib/embedding';
import { calculateFaceDetails } from '../lib/faceMetricCalculator';
import { calibrateDiagnoseDetails } from '../lib/diagnoseCalibration';
import { calculatePhotoQuality, type PhotoQualityAssessment } from '../lib/photoQuality';
import {
  assertDiagnosisBrowserSupport,
  getDiagnosisCompatibilityMessage,
  getDiagnosisRuntimeErrorMessage,
} from '../lib/browserCompatibility';
import ImageUploader from '../components/ImageUploader';
import {
  calculateAdjustedOverallScore,
  calculateMetricDistributions,
  createCelebrityScoreDeviationConverter,
  createGeneralScoreDeviationConverter,
} from '../lib/metricDistribution';
import {
  calculateHybridLookalikeSimilarity,
  findSimilarCelebritiesByDetails,
} from '../lib/lookalike';
import { filterPublicSiteCelebrities } from '../lib/publicVisibility';

const LookalikeResult = lazy(() => import('../components/LookalikeResult'));

interface DiagnoseResult {
  score: number;
  celebrityScore: number;
  details: ScoreDetails;
  photoQuality: PhotoQualityAssessment;
  lookalikes: { celebrity: Celebrity; similarity: number }[];
  toDeviation: (rawScore: number) => number;
  toCelebrityDeviation: (rawScore: number) => number;
}

type ProcessingStage = 'idle' | 'loading' | 'detecting' | 'scoring' | 'matching';

const DIAGNOSE_RAW_OFFSET = 3.2;
const MAX_DIAGNOSE_IMAGE_EDGE = 1800;
const MAX_DIAGNOSE_CANVAS_PIXELS = 3_600_000;

const PROCESSING_LABELS: Record<Exclude<ProcessingStage, 'idle'>, string> = {
  loading: '画像を準備中...',
  detecting: '写真を解析中...',
  scoring: '外見スコアを計算中...',
  matching: '似てる芸能人を探し中...',
};

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function getLoadedImageDimensions(img: HTMLImageElement): { width: number; height: number } {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions are unavailable.');
  }
  return { width, height };
}

function getDiagnosisCanvasSize(width: number, height: number): { width: number; height: number } {
  const edgeScale = Math.min(1, MAX_DIAGNOSE_IMAGE_EDGE / Math.max(width, height));
  const pixelScale = Math.min(
    1,
    Math.sqrt(MAX_DIAGNOSE_CANVAS_PIXELS / Math.max(width * height, 1)),
  );
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function prepareDiagnosisCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
): HTMLCanvasElement {
  const source = getLoadedImageDimensions(img);
  const target = getDiagnosisCanvasSize(source.width, source.height);
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  ctx.drawImage(img, 0, 0, target.width, target.height);
  return canvas;
}

function buildImagePreparationError(error: unknown): string {
  const detail = error instanceof Error ? error.message : error ? String(error) : '';
  return `画像を診断用に準備できませんでした。SafariやiPhoneで大きい写真、iCloud上の写真、HEIC写真を使っている場合は、端末にダウンロードしてから、またはJPEG/PNGで保存し直してから試してください。${detail ? ` (${detail})` : ''}`;
}

function getLookalikeDetailWeight(photoQuality: PhotoQualityAssessment): number {
  if (photoQuality.faceAreaRatio < 8) return 0.03;
  if (
    photoQuality.retryRecommended &&
    photoQuality.faceAreaRatio < 12 &&
    photoQuality.frontalScore < 50
  ) {
    return 0.06;
  }
  const baseWeight = 0.15 + ((photoQuality.overallScore - 40) / 60) * 0.2;
  return Math.max(0.15, Math.min(0.35, baseWeight));
}

function getLookalikeCandidateCount(photoQuality: PhotoQualityAssessment): number {
  if (photoQuality.faceAreaRatio < 8) return 24;
  if (
    photoQuality.retryRecommended &&
    photoQuality.faceAreaRatio < 12 &&
    photoQuality.frontalScore < 50
  ) {
    return 18;
  }
  return 12;
}

function getLookalikeEmbeddingGapThreshold(photoQuality: PhotoQualityAssessment): number {
  if (photoQuality.faceAreaRatio > 35 && photoQuality.sharpnessScore < 8) {
    return 0;
  }
  return 0.015;
}

function ResultFallback() {
  return (
    <div className="rounded-xl bg-slate-800 p-6 text-center text-slate-400">
      結果を読み込み中...
    </div>
  );
}

function buildPhotoQualityError(photoQuality: PhotoQualityAssessment): string {
  const reasons = photoQuality.blockingReasons.slice(0, 2).join(' ');
  return `この写真は診断に向きません。${reasons} 正面寄りで、人物がはっきり写った明るい写真で試してください。`;
}

export default function DiagnosePage() {
  const [celebrities, setCelebrities] = useState<Celebrity[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [embeddingStore, setEmbeddingStore] = useState<EmbeddingStore | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>('idle');
  const [uploadedImageSrc, setUploadedImageSrc] = useState<string | null>(null);
  const [photoQuality, setPhotoQuality] = useState<PhotoQualityAssessment | null>(null);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compatibilityWarning, setCompatibilityWarning] = useState<string | null>(null);
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const embeddingStorePromiseRef = useRef<Promise<EmbeddingStore | null> | null>(null);

  const scoringCelebrities = useMemo(
    () =>
      filterPublicSiteCelebrities(celebrities).filter(
        (celebrity) =>
          celebrity.gender === gender && celebrity.faceValidationStatus !== 'rejected',
      ),
    [celebrities, gender],
  );
  const metricDistributions = useMemo(
    () => calculateMetricDistributions(scoringCelebrities),
    [scoringCelebrities],
  );
  const toDeviation = useMemo(
    () => createGeneralScoreDeviationConverter(scoringCelebrities, 'face'),
    [scoringCelebrities],
  );
  const toCelebrityDeviation = useMemo(
    () => createCelebrityScoreDeviationConverter(scoringCelebrities, 'face'),
    [scoringCelebrities],
  );
  const processingLabel =
    processingStage === 'idle' ? null : PROCESSING_LABELS[processingStage];
  const modelBaseUrl = `${import.meta.env.BASE_URL}models`;
  const dataBaseUrl = `${import.meta.env.BASE_URL}data`;

  useEffect(() => {
    Promise.all([
      (async () => {
        assertDiagnosisBrowserSupport();
        await loadModels(modelBaseUrl);
      })(),
      fetch(`${dataBaseUrl}/celebrities.json`).then((r) => r.json()),
    ])
      .then(([, data]) => {
        setCelebrities(data as Celebrity[]);
        setModelsReady(true);
      })
      .catch((err) => {
        console.error(err);
        setError(
          getDiagnosisRuntimeErrorMessage(err) ??
            'モデルの読み込みに失敗しました。ページを再読み込みしてください。',
        );
      });
  }, [dataBaseUrl, modelBaseUrl]);

  useEffect(() => {
    try {
      assertDiagnosisBrowserSupport();
      setCompatibilityWarning(null);
    } catch (err) {
      setCompatibilityWarning(getDiagnosisCompatibilityMessage(err));
    }
  }, []);

  const ensureEmbeddingStore = useCallback(async (): Promise<EmbeddingStore | null> => {
    if (embeddingStore) {
      return embeddingStore;
    }

    if (!embeddingStorePromiseRef.current) {
      embeddingStorePromiseRef.current = loadEmbeddingStore(dataBaseUrl)
        .then((store) => {
          setEmbeddingStore(store);
          return store;
        })
        .catch((embeddingError) => {
          console.warn('Failed to load embedding store', embeddingError);
          return null;
        });
    }

    return embeddingStorePromiseRef.current;
  }, [dataBaseUrl, embeddingStore]);

  const handleUploadError = useCallback((message: string) => {
    setUploadedImageSrc(null);
    setProcessing(false);
    setProcessingStage('idle');
    setPhotoQuality(null);
    setResult(null);
    setError(message);
  }, []);

  const handleImage = useCallback(
    async (img: HTMLImageElement) => {
      if (!modelsReady) return;

      setUploadedImageSrc(img.src);
      setProcessing(true);
      setProcessingStage('loading');
      setError(null);
      setPhotoQuality(null);
      setResult(null);
      await nextPaint();

      try {
        assertDiagnosisBrowserSupport();
        const canvasElement = canvasRef.current;
        if (!canvasElement) {
          throw new Error('Diagnosis canvas is unavailable.');
        }

        let canvas: HTMLCanvasElement;
        try {
          canvas = prepareDiagnosisCanvas(canvasElement, img);
        } catch (imageError) {
          setError(buildImagePreparationError(imageError));
          return;
        }

        setProcessingStage('detecting');
        await nextPaint();
        const detection = await detectFace(canvas);
        if (!detection) {
          setError('診断に必要な特徴を検出できませんでした。正面寄りで1人だけ写った写真で試してください。');
          return;
        }

        setProcessingStage('scoring');
        await nextPaint();
        const baseDetails = calculateFaceDetails(detection.landmarks);
        const photoQuality = calculatePhotoQuality(detection.landmarks, detection.box, canvas);
        setPhotoQuality(photoQuality);
        if (!photoQuality.diagnosisReady) {
          setError(buildPhotoQualityError(photoQuality));
          return;
        }
        const filteredDetails = {
          ...baseDetails,
          symmetry: photoQuality.symmetryReliable ? baseDetails.symmetry : undefined,
        };
        const { details } = calibrateDiagnoseDetails(
          filteredDetails,
          photoQuality,
          metricDistributions,
        );
        const rawScore = calculateAdjustedOverallScore(details, metricDistributions) + DIAGNOSE_RAW_OFFSET;
        const score = toDeviation(rawScore);
        const celebrityScore = toCelebrityDeviation(rawScore);

        setProcessingStage('matching');
        await nextPaint();
        const queryEmbeddings = [
          detection.embedding,
          ...(detection.alternateEmbeddings ?? []),
        ].filter((embedding) => embedding.some((value) => value !== 0));
        const activeEmbeddingStore = queryEmbeddings.length > 0 ? await ensureEmbeddingStore() : null;
        const lookalikeDetailWeight = getLookalikeDetailWeight(photoQuality);
        const lookalikeCandidateCount = getLookalikeCandidateCount(photoQuality);
        const embeddingGapThreshold = getLookalikeEmbeddingGapThreshold(photoQuality);
        const embeddingMatches =
          activeEmbeddingStore && queryEmbeddings.length > 0
            ? findSimilarCelebritiesByAnyEmbedding(
                queryEmbeddings,
                scoringCelebrities,
                activeEmbeddingStore,
                lookalikeCandidateCount,
              )
            : [];

        const lookalikes =
          embeddingMatches.length > 0
            ? embeddingMatches
                .map(({ index, similarity }) => {
                  const celebrity = scoringCelebrities[index];
                  return {
                    celebrity,
                    embeddingSimilarity: similarity,
                    similarity: calculateHybridLookalikeSimilarity(
                      details,
                      rawScore,
                      celebrity,
                      similarity,
                      lookalikeDetailWeight,
                    ),
                  };
                })
                .sort((a, b) => {
                  const embeddingGap = b.embeddingSimilarity - a.embeddingSimilarity;
                  if (Math.abs(embeddingGap) > embeddingGapThreshold) {
                    return embeddingGap;
                  }
                  return b.similarity - a.similarity;
                })
                .slice(0, 5)
            : findSimilarCelebritiesByDetails(details, rawScore, scoringCelebrities, 5).map(
                ({ index, similarity }) => ({
                  celebrity: scoringCelebrities[index],
                  similarity,
                }),
              );

        setResult({
          score,
          celebrityScore,
          details,
          photoQuality,
          lookalikes,
          toDeviation,
          toCelebrityDeviation,
        });
      } catch (err) {
        console.error(err);
        setError(
          getDiagnosisRuntimeErrorMessage(err) ?? '診断中にエラーが発生しました。',
        );
      } finally {
        setProcessing(false);
        setProcessingStage('idle');
      }
    },
    [
      ensureEmbeddingStore,
      modelsReady,
      metricDistributions,
      scoringCelebrities,
      toCelebrityDeviation,
      toDeviation,
    ],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h2 className="mb-2 text-2xl font-bold">AI外見診断</h2>
          <p className="text-slate-400">
            写真から外見スコアと似てる芸能人を表示します。
          </p>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm text-slate-400">性別:</span>
          {([
            ['male', '男性'],
            ['female', '女性'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setGender(value)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                gender === value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!modelsReady && !error && (
          <div className="py-12 text-center text-slate-400">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            診断モデルを読み込み中...
          </div>
        )}

        {modelsReady && (
          <ImageUploader
            onImageSelected={handleImage}
            onError={handleUploadError}
            isProcessing={processing}
            processingLabel={processingLabel ?? undefined}
          />
        )}

        {compatibilityWarning && !error && (
          <div className="mt-4 rounded-lg border border-amber-700 bg-amber-950/50 p-4 text-amber-100">
            {compatibilityWarning}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-700 bg-red-900/50 p-4 text-red-300"
          >
            {error}
          </div>
        )}
      </div>

      {(uploadedImageSrc || result) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start md:gap-6">
          {uploadedImageSrc && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-400">診断した写真</div>
                  <div className="mt-1 text-sm text-slate-200">
                    {processingLabel ?? (result ? '診断完了' : '画像を読み込みました')}
                  </div>
                </div>
                {processingLabel && (
                  <span className="rounded-full bg-indigo-950 px-3 py-1 text-xs font-medium text-indigo-200">
                    {processingLabel}
                  </span>
                )}
              </div>
              <img
                src={uploadedImageSrc}
                alt="診断した写真"
                className="max-h-[420px] w-full rounded-lg bg-slate-950 object-contain"
              />
              {photoQuality && !processing && (
                <div
                  className={`mt-3 rounded-lg border px-4 py-3 text-sm ${
                    photoQuality.diagnosisReady
                      ? photoQuality.retryRecommended
                        ? 'border-amber-800 bg-amber-950/40 text-amber-100'
                        : 'border-emerald-800 bg-emerald-950/40 text-emerald-100'
                      : 'border-red-800 bg-red-950/40 text-red-100'
                  }`}
                >
                  <div className="font-medium">
                    {photoQuality.diagnosisReady
                      ? photoQuality.retryRecommended
                        ? '診断はできましたが、撮り直すと安定します'
                        : 'この写真は診断向きです'
                      : 'この写真は診断に向きません'}
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    {(photoQuality.diagnosisReady
                      ? photoQuality.notes
                      : photoQuality.blockingReasons
                    ).slice(0, 3).map((note) => (
                      <div key={note}>{note}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {result && (
            <Suspense fallback={<ResultFallback />}>
              <LookalikeResult
                score={result.score}
                celebrityScore={result.celebrityScore}
                details={result.details}
                photoQuality={result.photoQuality}
                lookalikes={result.lookalikes}
                toDeviation={result.toDeviation}
                toCelebrityDeviation={result.toCelebrityDeviation}
              />
            </Suspense>
          )}
        </div>
      )}

      <canvas ref={canvasRef} data-diagnosis-canvas="true" className="hidden" />
    </div>
  );
}
