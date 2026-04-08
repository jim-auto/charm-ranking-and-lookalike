import type { Celebrity } from '../types/celebrity';
import ScoreRadar from './ScoreRadar';

interface Props {
  celebrity: Celebrity;
  rank: number;
  useAge?: boolean;
  useSns?: boolean;
  formatFollowers?: (n: number) => string;
  toDeviation?: (score: number, age: boolean, sns: boolean) => number;
}

const categoryLabel: Record<string, string> = {
  actor: '男優',
  actress: '女優',
  idol: 'アイドル',
  influencer: 'インフルエンサー',
  artist: 'アーティスト',
  athlete: 'アスリート',
  comedian: '芸人',
  sumo: '力士',
  cultural: '文化人',
  musician: 'ミュージシャン',
  prowrestler: 'プロレスラー',
  youtuber: 'YouTuber',
};

function medalColor(rank: number): string {
  if (rank === 1) return 'text-yellow-400';
  if (rank === 2) return 'text-gray-300';
  if (rank === 3) return 'text-amber-600';
  return 'text-slate-500';
}

function getScore(c: Celebrity, age: boolean, sns: boolean): number {
  if (!c.scores) return c.score ?? 0;
  if (age && sns) return c.scores.faceAgeSns;
  if (age) return c.scores.faceAge;
  if (sns) return c.scores.faceSns;
  return c.scores.face;
}

export default function CelebrityCard({
  celebrity,
  rank,
  useAge = false,
  useSns = false,
  formatFollowers,
  toDeviation,
}: Props) {
  const rawScore = getScore(celebrity, useAge, useSns);
  const displayScore = toDeviation ? toDeviation(rawScore, useAge, useSns) : rawScore;
  const rawFaceDeviation = toDeviation ? toDeviation(celebrity.scores.face, false, false) : celebrity.scores.face;
  const hasModifier = useAge || useSns;

  return (
    <div className="rounded-xl bg-slate-800 px-3 py-2.5 sm:px-3.5 sm:py-3">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <div className={`w-7 shrink-0 text-center text-lg font-bold sm:w-8 sm:text-xl ${medalColor(rank)}`}>
          {rank}
        </div>

        <img
          src={celebrity.thumbnail}
          alt={celebrity.name}
          className="h-11 w-11 shrink-0 rounded-full bg-slate-700 object-cover sm:h-14 sm:w-14"
          loading="lazy"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[15px] font-semibold leading-tight sm:text-base">
                {celebrity.name}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="rounded-full bg-indigo-900 px-1.5 py-0.5 text-[10px] text-indigo-300 sm:text-[11px]">
                  {celebrity.group ?? (categoryLabel[celebrity.category] ?? celebrity.category)}
                </span>
                <span className="text-[11px] text-slate-500 sm:text-xs">
                  {celebrity.age != null ? `${celebrity.age}歳` : '年齢不明'}
                </span>
                {useSns && (celebrity.totalFollowers ?? 0) > 0 && formatFollowers && (
                  <span className="text-[11px] text-emerald-400 sm:text-xs">
                    SNS {formatFollowers(celebrity.totalFollowers!)}
                  </span>
                )}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xl font-bold leading-none text-indigo-400 sm:text-2xl">
                {displayScore}
              </div>
              {hasModifier && (
                <div className="mt-1 text-[10px] leading-none text-slate-500 sm:text-[11px]">
                  素点 {rawFaceDeviation}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-end sm:mt-1">
            <ScoreRadar details={celebrity.details} size="xs" />
          </div>
        </div>
      </div>
    </div>
  );
}
