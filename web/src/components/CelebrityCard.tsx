import type { Celebrity } from '../types/celebrity';
import ScoreRadar from './ScoreRadar';

interface Props {
  celebrity: Celebrity;
  rank: number;
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

export default function CelebrityCard({ celebrity, rank }: Props) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 flex items-center gap-4 hover:bg-slate-750 transition-colors">
      <div className={`text-2xl font-bold w-10 text-center ${medalColor(rank)}`}>
        {rank}
      </div>

      <img
        src={celebrity.thumbnail}
        alt={celebrity.name}
        className="w-16 h-16 rounded-full object-cover bg-slate-700"
        loading="lazy"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-lg truncate">{celebrity.name}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300">
            {categoryLabel[celebrity.category] ?? celebrity.category}
          </span>
        </div>
        <div className="text-indigo-400 text-2xl font-bold">
          {celebrity.score}
          <span className="text-sm text-slate-400 ml-1">点</span>
        </div>
      </div>

      <ScoreRadar details={celebrity.details} size="sm" />
    </div>
  );
}
