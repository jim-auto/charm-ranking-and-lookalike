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

function confidenceLabel(level: PhotoQualityAssessment['symmetryConfidence']): string {
  if (level === 'high') return '高信頼';
  if (level === 'medium') return '中信頼';
  return '低信頼';
}

function confidenceClass(level: PhotoQualityAssessment['symmetryConfidence']): string {
  if (level === 'high') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
  if (level === 'medium') return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
  return 'text-rose-300 bg-rose-500/10 border-rose-500/30';
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
  const symmetryState = photoQuality.symmetryReliable
    ? confidenceLabel(photoQuality.symmetryConfidence)
    : '参考外';
  const contourState = photoQuality.contourReliable
    ? confidenceLabel(photoQuality.contourConfidence)
    : '参考寄り';

  const symmetryClass = photoQuality.symmetryReliable
    ? confidenceClass(photoQuality.symmetryConfidence)
    : 'text-slate-300 bg-slate-700/40 border-slate-600/50';
  const contourClass = photoQuality.contourReliable
    ? confidenceClass(photoQuality.contourConfidence)
    : 'text-slate-300 bg-slate-700/40 border-slate-600/50';

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-xl p-6">
        <div className="text-center">
          <h3 className="text-lg text-slate-300 mb-2">あなたの顔面偏差値</h3>
          <div className="text-5xl font-bold text-indigo-400 mb-4">{score}</div>
          <div className="flex justify-center">
            <ScoreRadar details={details} size="md" />
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <QualityMetric label="写真品質" value={photoQuality.overallScore} hint="アップロード画像の総合安定度" />
          <QualityMetric label="正面度" value={photoQuality.frontalScore} hint="左右対称の見やすさ" />
          <QualityMetric label="シャープさ" value={photoQuality.sharpnessScore} hint="ぼけの少なさ" />
          <QualityMetric label="顔の収まり" value={photoQuality.cropScore} hint="輪郭の取りやすさ" />
          <QualityMetric label="傾き" value={`${photoQuality.rollDegrees}°`} hint="0°に近いほど安定" />
          <QualityMetric label="横向き耐性" value={photoQuality.yawScore} hint="正面に近いほど高評価" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <div className={`rounded-full border px-3 py-1 text-sm ${symmetryClass}`}>
            左右対称: {symmetryState}
          </div>
          <div className={`rounded-full border px-3 py-1 text-sm ${contourClass}`}>
            輪郭: {contourState}
          </div>
          {!photoQuality.symmetryReliable && (
            <div className="rounded-full border border-slate-600/50 bg-slate-700/40 px-3 py-1 text-sm text-slate-300">
              正面写真を追加すると左右対称の精度が上がります
            </div>
          )}
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
          <h3 className="text-lg font-semibold mb-4">似ている芸能人 Top {lookalikes.length}</h3>
          <div className="space-y-3">
            {lookalikes.map(({ celebrity, similarity }, i) => (
              <div key={celebrity.id} className="flex items-center gap-3">
                <span className="text-lg font-bold text-slate-400 w-6">{i + 1}.</span>
                <img
                  src={celebrity.thumbnail}
                  alt={celebrity.name}
                  className="w-12 h-12 rounded-full object-cover bg-slate-700"
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
                <div className="text-indigo-400 font-bold">{Math.round(similarity * 100)}% 一致</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
