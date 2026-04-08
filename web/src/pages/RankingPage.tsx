import { useEffect, useMemo, useState } from 'react';
import type { Celebrity } from '../types/celebrity';
import { createDeviationConverter } from '../lib/faceScoring';
import CelebrityCard from '../components/CelebrityCard';
import ScoreBreakdown from '../components/ScoreBreakdown';

const genderFilters = [
  { value: '', label: 'すべて' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
];

const rankingScopes = [
  { value: 'recommended', label: 'おすすめ表示' },
  { value: 'all', label: '全カテゴリ' },
] as const;

const categoryLabels: Record<string, string> = {
  actor: '俳優',
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

const categoryOrder = [
  'actor',
  'actress',
  'idol',
  'influencer',
  'artist',
  'athlete',
  'comedian',
  'sumo',
  'cultural',
  'musician',
  'prowrestler',
  'youtuber',
];

type RankingScope = (typeof rankingScopes)[number]['value'];

function getScore(c: Celebrity, age: boolean, sns: boolean): number {
  if (!c.scores) return c.score ?? 0;
  if (age && sns) return c.scores.faceAgeSns;
  if (age) return c.scores.faceAge;
  if (sns) return c.scores.faceSns;
  return c.scores.face;
}

function formatFollowers(n: number): string {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + '千万';
  if (n >= 10000) return Math.round(n / 10000) + '万';
  return String(n);
}

function sortCategoryValues(a: string, b: string): number {
  const ai = categoryOrder.indexOf(a);
  const bi = categoryOrder.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b, 'ja');
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export default function RankingPage() {
  const [celebrities, setCelebrities] = useState<Celebrity[]>([]);
  const [rankingScope, setRankingScope] = useState<RankingScope>('recommended');
  const [genderFilter, setGenderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [useAge, setUseAge] = useState(true);
  const [useSns, setUseSns] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const perPage = 30;

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/celebrities.json`)
      .then((res) => res.json())
      .then((data: Celebrity[]) => setCelebrities(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [rankingScope, genderFilter, categoryFilter, searchQuery, useAge, useSns]);

  const toDeviation = useMemo(() => {
    if (celebrities.length === 0) return (_score: number, _age: boolean, _sns: boolean) => 0;
    const convFace = createDeviationConverter(celebrities, 'face');
    const convFaceAge = createDeviationConverter(celebrities, 'faceAge');
    const convFaceSns = createDeviationConverter(celebrities, 'faceSns');
    const convFaceAgeSns = createDeviationConverter(celebrities, 'faceAgeSns');
    return (score: number, age: boolean, sns: boolean) => {
      if (age && sns) return convFaceAgeSns(score);
      if (age) return convFaceAge(score);
      if (sns) return convFaceSns(score);
      return convFace(score);
    };
  }, [celebrities]);

  const categoryFilters = useMemo(() => {
    const values = Array.from(
      new Set(celebrities.map((c) => c.category).filter(Boolean))
    ).sort(sortCategoryValues);
    return [
      { value: '', label: 'すべて' },
      ...values.map((value) => ({
        value,
        label: categoryLabels[value] ?? value,
      })),
    ];
  }, [celebrities]);

  const excludedCount = useMemo(
    () => celebrities.filter((c) => c.rankingEligible === false).length,
    [celebrities]
  );

  const sorted = useMemo(() => {
    let list = [...celebrities];
    if (rankingScope === 'recommended') {
      list = list.filter((c) => c.rankingEligible !== false);
    }
    if (genderFilter) list = list.filter((c) => c.gender === genderFilter);
    if (categoryFilter) list = list.filter((c) => c.category === categoryFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.group && c.group.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => getScore(b, useAge, useSns) - getScore(a, useAge, useSns));
    return list;
  }, [celebrities, rankingScope, genderFilter, categoryFilter, searchQuery, useAge, useSns]);

  const totalPages = Math.ceil(sorted.length / perPage);
  const paged = sorted.slice((page - 1) * perPage, page * perPage);
  const rankOffset = (page - 1) * perPage;

  return (
    <div>
      <div className="mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="名前・グループで検索..."
          className="w-full px-4 py-2 rounded-lg bg-slate-800 text-white placeholder-slate-500 border border-slate-700 focus:border-indigo-500 focus:outline-none text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-slate-400 mr-1">表示:</span>
        {rankingScopes.map((scope) => (
          <button
            key={scope.value}
            onClick={() => setRankingScope(scope.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              rankingScope === scope.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {scope.label}
          </button>
        ))}
      </div>

      {rankingScope === 'recommended' && excludedCount > 0 && (
        <div className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          写真バイアスが出やすい {excludedCount} 件はおすすめ表示から外しています。必要なら「全カテゴリ」で確認できます。
        </div>
      )}

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
        {categoryFilters.map((cat) => (
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

      <div className="flex flex-wrap items-center gap-3 mb-6 p-3 bg-slate-800/50 rounded-lg">
        <span className="text-sm text-slate-400">補正:</span>

        <button
          onClick={() => setUseAge(!useAge)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
            useAge
              ? 'bg-amber-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }`}
        >
          <span className={`inline-block w-3 h-3 rounded-sm border ${useAge ? 'bg-white border-white' : 'border-slate-500'}`}>
            {useAge && <span className="block text-amber-600 text-xs leading-3 text-center font-bold">✓</span>}
          </span>
          年齢
        </button>

        <button
          onClick={() => setUseSns(!useSns)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
            useSns
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }`}
        >
          <span className={`inline-block w-3 h-3 rounded-sm border ${useSns ? 'bg-white border-white' : 'border-slate-500'}`}>
            {useSns && <span className="block text-emerald-600 text-xs leading-3 text-center font-bold">✓</span>}
          </span>
          SNS影響力
        </button>

        <span className="text-xs text-slate-500">
          {!useAge && !useSns && '顔の比率のみ'}
          {useAge && !useSns && '20代前半ピークで年齢補正'}
          {!useAge && useSns && '顔 70% + SNS 30%'}
          {useAge && useSns && '顔 70% + SNS 30% + 年齢補正'}
        </span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">読み込み中...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-slate-400">データがありません</div>
      ) : (
        <>
          <div className="space-y-2.5 sm:space-y-3">
            {paged.map((celeb, i) => (
              <CelebrityCard
                key={celeb.id}
                celebrity={celeb}
                rank={rankOffset + i + 1}
                useAge={useAge}
                useSns={useSns}
                formatFollowers={formatFollowers}
                toDeviation={toDeviation}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-6">
              <button
                onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo(0, 0); }}
                disabled={page === 1}
                className="px-3 py-1.5 rounded text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {'<'}
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => { setPage(p); window.scrollTo(0, 0); }}
                  className={`w-9 h-9 rounded text-sm font-medium transition-colors ${
                    page === p
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); window.scrollTo(0, 0); }}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {'>'}
              </button>
            </div>
          )}
        </>
      )}

      <ScoreBreakdown />
    </div>
  );
}
