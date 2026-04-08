import type { PhotoQualityAssessment } from '../lib/photoQuality';
import type { Celebrity, ScoreDetails } from '../types/celebrity';
import ScoreRadar from './ScoreRadar';

interface Props {
  score: number;
  details: ScoreDetails;
  photoQuality: PhotoQualityAssessment;
  lookalikes: { celebrity: Celebrity; similarity: number }[];
  toDeviation?: (rawScore: number) => number;
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

export default function LookalikeResult({
  score,
  details,
  photoQuality,
  lookalikes,
  toDeviation,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-xl p-6">
        <div className="text-center">
          <h3 className="mb-2 text-lg text-slate-300">診断スコア</h3>
          <div className="mb-4 text-5xl font-bold text-indigo-400">{score}</div>
          <div className="flex justify-center">
            <ScoreRadar details={details} size="md" />
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <QualityMetric label="写真品質" value={photoQuality.overallScore} hint="この写真の安定度" />
          <QualityMetric label="正面度" value={photoQuality.frontalScore} hint="正面寄りほど安定" />
          <QualityMetric label="シャープさ" value={photoQuality.sharpnessScore} hint="ピント" />
          <QualityMetric label="顔の収まり" value={photoQuality.cropScore} hint="顔の収まり具合" />
          <QualityMetric label="傾き" value={`${photoQuality.rollDegrees}°`} hint="0°に近いほど安定" />
          <QualityMetric label="横向き耐性" value={photoQuality.yawScore} hint="正面寄りほど安定" />
        </div>

        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
          <div className="text-sm font-medium text-slate-200">写真チェック</div>
          <ul className="mt-2 space-y-2 text-sm text-slate-300">
            {photoQuality.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </div>

      {lookalikes.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6">
          <h3 className="mb-4 text-lg font-semibold">似ている芸能人 Top {lookalikes.length}</h3>
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
                  <div className="text-sm text-slate-400">
                    偏差値:{' '}
                    {toDeviation
                      ? toDeviation(celebrity.scores?.face ?? celebrity.score)
                      : celebrity.score}
                  </div>
                </div>
                <div className="font-bold text-indigo-400">{Math.round(similarity * 100)}% 一致</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
