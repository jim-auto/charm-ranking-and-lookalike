import { useCallback, useEffect, useRef, useState } from 'react';
import type { Celebrity } from '../types/celebrity';
import { loadModels, detectFace } from '../lib/faceDetection';
import { calculateFaceScore, totalScore } from '../lib/faceScoring';
import { findSimilarCelebrities } from '../lib/embedding';
import ImageUploader from '../components/ImageUploader';
import LookalikeResult from '../components/LookalikeResult';
import type { ScoreDetails } from '../types/celebrity';

interface DiagnoseResult {
  score: number;
  details: ScoreDetails;
  lookalikes: { celebrity: Celebrity; similarity: number }[];
}

export default function DiagnosePage() {
  const [celebrities, setCelebrities] = useState<Celebrity[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

        const details = calculateFaceScore(detection.landmarks);
        const score = totalScore(details);

        const similar = findSimilarCelebrities(detection.embedding, celebrities, 5);
        const lookalikes = similar.map(({ index, similarity }) => ({
          celebrity: celebrities[index],
          similarity,
        }));

        setResult({ score, details, lookalikes });
      } catch (err) {
        console.error(err);
        setError('処理中にエラーが発生しました。');
      } finally {
        setProcessing(false);
      }
    },
    [modelsReady, celebrities],
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">顔面偏差値診断</h2>
        <p className="text-slate-400">
          あなたの顔写真から偏差値を算出し、似ている芸能人を見つけます。
        </p>
      </div>

      {!modelsReady && !error && (
        <div className="text-center py-12 text-slate-400">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full mx-auto mb-3" />
          AIモデルを読み込んでいます...
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
            lookalikes={result.lookalikes}
          />
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      <div className="mt-8 p-4 bg-slate-800/50 rounded-lg text-sm text-slate-500">
        <p>
          ※ 偏差値は顔の数学的比率に基づく指標であり、美の絶対評価ではありません。
        </p>
        <p>
          ※ アップロードした画像はブラウザ内のみで処理され、サーバーには送信されません。
        </p>
      </div>
    </div>
  );
}
