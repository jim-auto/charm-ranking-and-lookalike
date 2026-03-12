import { useEffect, useMemo, useState } from 'react';
import type { Celebrity, ScoreMode } from '../types/celebrity';
import CelebrityCard from '../components/CelebrityCard';

const genderFilters = [
  { value: '', label: 'すべて' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
];

const categories = [
  { value: '', label: 'すべて' },
  { value: 'actor', label: '俳優' },
  { value: 'actress', label: '女優' },
  { value: 'idol', label: 'アイドル' },
  { value: 'influencer', label: 'インフルエンサー' },
];

const scoreModes: { value: ScoreMode; label: string; desc: string }[] = [
  { value: 'face', label: '顔面偏差値', desc: '顔の比率のみ' },
  { value: 'age', label: '年齢考慮', desc: '20代前半ピークで補正' },
  { value: 'charm', label: '魅力度', desc: '顔 70% + SNS影響力 30%' },
];

function getScore(c: Celebrity, mode: ScoreMode): number {
  if (mode === 'age') return c.scoreWithAge;
  if (mode === 'charm') return c.scoreCharm;
  return c.score;
}

function formatFollowers(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + '千万';
  if (n >= 10000) return Math.round(n / 10000) + '万';
  return String(n);
}

export default function RankingPage() {
  const [celebrities, setCelebrities] = useState<Celebrity[]>([]);
  const [genderFilter, setGenderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [scoreMode, setScoreMode] = useState<ScoreMode>('face');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/celebrities.json`)
      .then((res) => res.json())
      .then((data: Celebrity[]) => setCelebrities(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    let list = [...celebrities];
    if (genderFilter) list = list.filter((c) => c.gender === genderFilter);
    if (categoryFilter) list = list.filter((c) => c.category === categoryFilter);
    list.sort((a, b) => getScore(b, scoreMode) - getScore(a, scoreMode));
    return list;
  }, [celebrities, genderFilter, categoryFilter, scoreMode]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-slate-400 mr-1">性別:</span>
        {genderFilters.map((g) => (
          <button
            key={g.value}
            onClick={() => setGenderFilter(g.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              genderFilter === g.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-slate-400 mr-1">ジャンル:</span>
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategoryFilter(cat.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              categoryFilter === cat.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6 p-3 bg-slate-800/50 rounded-lg">
        <span className="text-sm text-slate-400 mr-1">モード:</span>
        {scoreModes.map((m) => (
          <button
            key={m.value}
            onClick={() => setScoreMode(m.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              scoreMode === m.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {m.label}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-1">
          {scoreModes.find((m) => m.value === scoreMode)?.desc}
        </span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">読み込み中...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-slate-400">データがありません</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((celeb, i) => (
            <CelebrityCard
              key={celeb.id}
              celebrity={celeb}
              rank={i + 1}
              scoreMode={scoreMode}
              formatFollowers={formatFollowers}
            />
          ))}
        </div>
      )}
    </div>
  );
}
