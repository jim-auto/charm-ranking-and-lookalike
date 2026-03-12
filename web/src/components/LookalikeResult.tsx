import type { Celebrity, ScoreDetails } from '../types/celebrity';
import ScoreRadar from './ScoreRadar';

interface Props {
  score: number;
  details: ScoreDetails;
  lookalikes: { celebrity: Celebrity; similarity: number }[];
}

export default function LookalikeResult({ score, details, lookalikes }: Props) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-xl p-6 text-center">
        <h3 className="text-lg text-slate-300 mb-2">あなたのスコア</h3>
        <div className="text-5xl font-bold text-indigo-400 mb-4">
          {score}
          <span className="text-xl text-slate-400 ml-1">点</span>
        </div>
        <div className="flex justify-center">
          <ScoreRadar details={details} size="md" />
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
                  <div className="text-sm text-slate-400">スコア: {celebrity.score}点</div>
                </div>
                <div className="text-indigo-400 font-bold">
                  {Math.round(similarity * 100)}% 一致
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
