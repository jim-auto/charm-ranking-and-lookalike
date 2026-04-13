import type { PhotoQualityAssessment } from '../lib/photoQuality';
import type { Celebrity, ScoreDetails } from '../types/celebrity';
import ScoreRadar from './ScoreRadar';

interface Props {
  score: number;
  celebrityScore: number;
  details: ScoreDetails;
  photoQuality: PhotoQualityAssessment;
  lookalikes: { celebrity: Celebrity; similarity: number }[];
  toDeviation?: (rawScore: number) => number;
  toCelebrityDeviation?: (rawScore: number) => number;
}

function QualityMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function LookalikeResult({
  score,
  celebrityScore,
  details,
  photoQuality,
  lookalikes,
  toDeviation,
  toCelebrityDeviation,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-slate-800 p-6">
        <div className="flex justify-center gap-6">
          <div className="text-center">
            <h3 className="mb-2 text-sm text-slate-400">一般偏差値</h3>
            <div className="text-5xl font-bold text-indigo-400">
              {formatScore(score)}
            </div>
          </div>
          <div className="text-center">
            <h3 className="mb-2 text-sm text-slate-400">芸能人偏差値</h3>
            <div className="text-5xl font-bold text-emerald-400">
              {formatScore(celebrityScore)}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-center">
          <ScoreRadar details={details} size="md" />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <QualityMetric label="写真品質" value={photoQuality.overallScore} hint="全体の見やすさ" />
          <QualityMetric label="正面度" value={photoQuality.frontalScore} hint="正面に近いほど高め" />
          <QualityMetric label="シャープさ" value={photoQuality.sharpnessScore} hint="ピントの強さ" />
          <QualityMetric label="顔の収まり" value={photoQuality.cropScore} hint="切れすぎを確認" />
          <QualityMetric label="顔の大きさ" value={`${photoQuality.faceAreaRatio}%`} hint="顔が大きいほど安定" />
          <QualityMetric label="傾き" value={`${photoQuality.rollDegrees}°`} hint="0°に近いほど安定" />
          <QualityMetric label="横向き度" value={photoQuality.yawScore} hint="正面に近いほど高め" />
        </div>

        {photoQuality.retryRecommended && (
          <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-left">
            <div className="text-sm font-medium text-amber-100">撮り直すと結果が安定しやすいです</div>
            <div className="mt-2 space-y-1 text-xs text-amber-200">
              {photoQuality.notes.slice(0, 3).map((note) => (
                <div key={note}>{note}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {lookalikes.length > 0 && (
        <div className="rounded-xl bg-slate-800 p-6">
          <h3 className="mb-4 text-lg font-semibold">似てる芸能人 Top {lookalikes.length}</h3>
          <div className="space-y-3">
            {lookalikes.map(({ celebrity, similarity }, index) => (
              <div key={celebrity.id} className="flex items-center gap-3">
                <span className="w-6 text-lg font-bold text-slate-400">{index + 1}.</span>
                <img
                  src={celebrity.thumbnail}
                  alt={celebrity.name}
                  className="h-12 w-12 rounded-full bg-slate-700 object-cover"
                />
                <div className="flex-1">
                  <div className="font-medium">{celebrity.name}</div>
                  <div className="flex gap-3 text-sm text-slate-400">
                    <span>
                      一般{' '}
                      <span className="text-indigo-400">
                        {toDeviation
                          ? formatScore(toDeviation(celebrity.scores?.face ?? celebrity.score))
                          : formatScore(celebrity.score)}
                      </span>
                    </span>
                    {toCelebrityDeviation && (
                      <span>
                        芸能人{' '}
                        <span className="text-emerald-400">
                          {formatScore(toCelebrityDeviation(celebrity.scores?.face ?? celebrity.score))}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="font-bold text-indigo-400">
                  {Math.round(similarity)}% 似てる
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
