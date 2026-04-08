import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Celebrity } from '../types/celebrity';
import { loadModels, detectFace } from '../lib/faceDetection';
import { calculateFaceDetails } from '../lib/faceMetricCalculator';
import { calculatePhotoQuality, type PhotoQualityAssessment } from '../lib/photoQuality';
import { findSimilarCelebrities, loadEmbeddingStore } from '../lib/embedding';
import ImageUploader from '../components/ImageUploader';
import LookalikeResult from '../components/LookalikeResult';
import type { ScoreDetails } from '../types/celebrity';
import {
  calculateAdjustedOverallScore,
  calculateMetricDistributions,
  createCelebrityScoreDeviationConverter,
} from '../lib/metricDistribution';

interface DiagnoseResult {
  score: number;
  details: ScoreDetails;
  photoQuality: PhotoQualityAssessment;
  lookalikes: { celebrity: Celebrity; similarity: number }[];
  toDeviation: (rawScore: number) => number;
}

export default function DiagnosePage() {
  const [celebrities, setCelebrities] = useState<Celebrity[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const scoringCelebrities = useMemo(
    () =>
      celebrities.filter(
        (celebrity) =>
          celebrity.gender === gender && celebrity.faceValidationStatus !== 'rejected'
      ),
    [celebrities, gender]
  );
  const metricDistributions = useMemo(
    () => calculateMetricDistributions(scoringCelebrities),
    [scoringCelebrities]
  );
  const toDeviation = useMemo(
    () => createCelebrityScoreDeviationConverter(scoringCelebrities, 'face'),
    [scoringCelebrities]
  );

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    Promise.all([
      loadModels(`${base}models`),
      fetch(`${base}data/celebrities.json`).then((r) => r.json()),
    ])
      .then(([, data]) => {
        setCelebrities(data as Celebrity[]);
        setModelsReady(true);
      })
      .catch((err) => {
        console.error(err);
        setError('モデルの読み込みに失敗しました。ページをリロードしてください。');
      });
  }, []);

  const handleImage = useCallback(
    async (img: HTMLImageElement) => {
      if (!modelsReady) return;
      setProcessing(true);
      setError(null);
      setResult(null);

      try {
        const canvas = canvasRef.current!;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        const detection = await detectFace(canvas);
        if (!detection) {
          setError('顔を検出できませんでした。正面からの顔写真をお試しください。');
          return;
        }

        const baseDetails = calculateFaceDetails(detection.landmarks);
        const photoQuality = calculatePhotoQuality(detection.landmarks, detection.box, canvas);
        const details = {
          ...baseDetails,
          symmetry: photoQuality.symmetryReliable ? baseDetails.symmetry : undefined,
        };
        const rawScore = calculateAdjustedOverallScore(details, metricDistributions);
        const score = toDeviation(rawScore);

        const embeddingStore = await loadEmbeddingStore(`${import.meta.env.BASE_URL}data`);
        const similar = findSimilarCelebrities(
          detection.embedding,
          scoringCelebrities,
          embeddingStore,
          5
        );
        const lookalikes = similar.map(({ index, similarity }) => ({
          celebrity: scoringCelebrities[index],
          similarity,
        }));

        setResult({ score, details, photoQuality, lookalikes, toDeviation });
      } catch (err) {
        console.error(err);
        setError('処理中にエラーが発生しました。');
      } finally {
        setProcessing(false);
      }
    },
    [modelsReady, metricDistributions, scoringCelebrities, toDeviation],
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">AIスト値診断</h2>
        <p className="text-slate-400">
          写真からスコアを出して、近い芸能人を探します。
        </p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm text-slate-400">性別:</span>
        {([['male', '男性'], ['female', '女性']] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setGender(val)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              gender === val
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!modelsReady && !error && (
        <div className="text-center py-12 text-slate-400">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full mx-auto mb-3" />
          診断モデルを読み込み中...
        </div>
      )}

      {modelsReady && <ImageUploader onImageSelected={handleImage} isProcessing={processing} />}

      {error && (
        <div className="mt-4 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6">
          <LookalikeResult
            score={result.score}
            details={result.details}
            photoQuality={result.photoQuality}
            lookalikes={result.lookalikes}
            toDeviation={result.toDeviation}
          />
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      <div className="mt-8 p-4 bg-slate-800/50 rounded-lg text-sm text-slate-500 space-y-2">
        <p>
          ※ 数値は参考スコアです。
        </p>
        <p>
          ※ 画像はブラウザ内だけで処理。
        </p>
        <p>※ 左右対称は正面寄りの写真向き。</p>
      </div>
    </div>
  );
}
