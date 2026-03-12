import type { Celebrity, ScoreMode } from '../types/celebrity';
import ScoreRadar from './ScoreRadar';

interface Props {
  celebrity: Celebrity;
  rank: number;
  scoreMode?: ScoreMode;
  formatFollowers?: (n: number) => string;
}

const categoryLabel: Record<string, string> = {
  actor: '俳優',
  actress: '女優',
  idol: 'アイドル',
  influencer: 'インフルエンサー',
};

function medalColor(rank: number): string {
  if (rank === 1) return 'text-yellow-400';
  if (rank === 2) return 'text-gray-300';
  if (rank === 3) return 'text-amber-600';
  return 'text-slate-500';
}

function getDisplayScore(c: Celebrity, mode: ScoreMode): number {
  if (mode === 'age') return c.scoreWithAge;
  if (mode === 'charm') return c.scoreCharm;
  return c.score;
}

export default function CelebrityCard({
  celebrity,
  rank,
  scoreMode = 'face',
  formatFollowers,
}: Props) {
  const displayScore = getDisplayScore(celebrity, scoreMode);

  return (
    <div className="bg-slate-800 rounded-xl p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <div className={`text-xl sm:text-2xl font-bold w-8 sm:w-10 text-center shrink-0 ${medalColor(rank)}`}>
          {rank}
        </div>

        <img
          src={celebrity.thumbnail}
          alt={celebrity.name}
          className="w-12 h-12 sm:w-16 sm:h-16 rounded-full object-cover bg-slate-700 shrink-0"
          loading="lazy"
        />

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base sm:text-lg leading-tight">{celebrity.name}</h3>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-900 text-indigo-300">
              {categoryLabel[celebrity.category] ?? celebrity.category}
            </span>
            <span className="text-xs text-slate-500">{celebrity.age}歳</span>
            {scoreMode === 'charm' && celebrity.totalFollowers > 0 && formatFollowers && (
              <span className="text-xs text-emerald-400">
                SNS {formatFollowers(celebrity.totalFollowers)}
              </span>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-indigo-400 text-2xl sm:text-3xl font-bold">
            {displayScore}
          </div>
          {scoreMode !== 'face' && (
            <div className="text-xs text-slate-500">
              顔 {celebrity.score}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center mt-3">
        <ScoreRadar details={celebrity.details} size="sm" />
      </div>
    </div>
  );
}
