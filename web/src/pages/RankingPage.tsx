import { useEffect, useMemo, useState } from 'react';
import type { Celebrity } from '../types/celebrity';
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

export default function RankingPage() {
  const [celebrities, setCelebrities] = useState<Celebrity[]>([]);
  const [genderFilter, setGenderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [useAge, setUseAge] = useState(false);
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
    list.sort((a, b) =>
      useAge ? b.scoreWithAge - a.scoreWithAge : b.score - a.score,
    );
    return list;
  }, [celebrities, genderFilter, categoryFilter, useAge]);

  return (
    <div>
      {/* Gender filter */}
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

      {/* Category filter */}
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

      {/* Score mode */}
      <div className="flex items-center gap-3 mb-6 p-3 bg-slate-800/50 rounded-lg">
        <span className="text-sm text-slate-400">モード:</span>
        <button
          onClick={() => setUseAge(false)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            !useAge
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          顔面偏差値
        </button>
        <button
          onClick={() => setUseAge(true)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            useAge
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          年齢考慮
        </button>
        {useAge && (
          <span className="text-xs text-slate-500">※ 20代前半をピークに年齢で補正</span>
        )}
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
              useAge={useAge}
            />
          ))}
        </div>
      )}
    </div>
  );
}
