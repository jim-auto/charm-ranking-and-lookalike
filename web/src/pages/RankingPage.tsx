import { useEffect, useState } from 'react';
import type { Celebrity } from '../types/celebrity';
import CelebrityCard from '../components/CelebrityCard';

const categories = [
  { value: '', label: 'すべて' },
  { value: 'actor', label: '俳優' },
  { value: 'actress', label: '女優' },
  { value: 'idol', label: 'アイドル' },
  { value: 'influencer', label: 'インフルエンサー' },
];

export default function RankingPage() {
  const [celebrities, setCelebrities] = useState<Celebrity[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/celebrities.json`)
      .then((res) => res.json())
      .then((data: Celebrity[]) => {
        data.sort((a, b) => b.score - a.score);
        setCelebrities(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? celebrities.filter((c) => c.category === filter)
    : celebrities;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilter(cat.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              filter === cat.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">データがありません</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((celeb, i) => (
            <CelebrityCard key={celeb.id} celebrity={celeb} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
