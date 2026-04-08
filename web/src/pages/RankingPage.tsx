import { useEffect, useMemo, useState } from 'react';
import type { Celebrity } from '../types/celebrity';
import { createDeviationConverter } from '../lib/faceScoring';
import {
  type DetailRankingMetric,
  getRankingMetricLabel,
  getRankingMetricValue,
  isOverallMetric,
  rankingMetricOptions,
  type RankingMetric,
} from '../lib/rankingMetrics';
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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

function createValueDeviationConverter(values: number[]): (rawValue: number) => number {
  const validValues = values.filter((value) => Number.isFinite(value));
  const count = validValues.length;
  if (count === 0) return () => 50;

  const mean = validValues.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    validValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) return () => 50;

  return (rawValue: number) =>
    Math.round((50 + 10 * (rawValue - mean) / standardDeviation) * 10) / 10;
}

function formatFollowers(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}千万`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  return String(n);
}

function formatAgeStat(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value.toFixed(1)}歳`;
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
  const [rankingMetric, setRankingMetric] = useState<RankingMetric>('overall');
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
  }, [rankingScope, rankingMetric, genderFilter, categoryFilter, searchQuery, useAge, useSns]);

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

  const toMetricDeviation = useMemo(() => {
    const converters: Partial<Record<DetailRankingMetric, (rawValue: number) => number>> = {};
    const detailMetricOptions = rankingMetricOptions.filter(
      (
        metricOption
      ): metricOption is (typeof rankingMetricOptions)[number] & { value: DetailRankingMetric } =>
        metricOption.value !== 'overall'
    );

    detailMetricOptions.forEach((metricOption) => {
      const values = celebrities
        .map((celebrity) => celebrity.details?.[metricOption.value])
        .filter((value): value is number => typeof value === 'number');

      converters[metricOption.value] = createValueDeviationConverter(values);
    });

    return (metric: DetailRankingMetric, rawValue: number) =>
      converters[metric]?.(rawValue) ?? null;
  }, [celebrities]);

  const categoryFilters = useMemo(() => {
    const values = Array.from(new Set(celebrities.map((c) => c.category).filter(Boolean))).sort(sortCategoryValues);
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

  const selectedMetric = useMemo(
    () => rankingMetricOptions.find((option) => option.value === rankingMetric) ?? rankingMetricOptions[0],
    [rankingMetric]
  );
  const usesOverallScore = isOverallMetric(rankingMetric);

  const sorted = useMemo(() => {
    let list = [...celebrities];
    list = list.filter((c) => c.faceValidationStatus !== 'rejected');
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
    list.sort(
      (a, b) =>
        getRankingMetricValue(b, rankingMetric, useAge, useSns) -
        getRankingMetricValue(a, rankingMetric, useAge, useSns)
    );
    return list;
  }, [celebrities, rankingScope, rankingMetric, genderFilter, categoryFilter, searchQuery, useAge, useSns]);

  const summary = useMemo(() => {
    const ages = sorted
      .map((c) => c.age)
      .filter((age): age is number => typeof age === 'number');
    const averageAge =
      ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : null;

    return {
      total: sorted.length,
      ageCount: ages.length,
      averageAge,
      medianAge: median(ages),
    };
  }, [sorted]);

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
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-slate-400">表示:</span>
        {rankingScopes.map((scope) => (
          <button
            key={scope.value}
            onClick={() => setRankingScope(scope.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
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
          写真バイアスやカテゴリ調整のため {excludedCount} 件はおすすめ表示から外しています。必要なら「全カテゴリ」で確認できます。
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-slate-400">性別:</span>
        {genderFilters.map((g) => (
          <button
            key={g.value}
            onClick={() => setGenderFilter(g.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              genderFilter === g.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-slate-400">ジャンル:</span>
        {categoryFilters.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategoryFilter(cat.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              categoryFilter === cat.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-slate-400">指標:</span>
        {rankingMetricOptions.map((metric) => (
          <button
            key={metric.value}
            onClick={() => setRankingMetric(metric.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              rankingMetric === metric.value
                ? metric.isReference
                  ? 'bg-amber-600 text-white'
                  : 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={metric.description}
          >
            {metric.label}
          </button>
        ))}
      </div>

      <div className="mb-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
        {usesOverallScore ? (
          <>総合ランキングは偏差値ベースで並べています。肌スコアは全員75固定なのでランキング対象から外しています。</>
        ) : (
          <>
            現在は「{getRankingMetricLabel(rankingMetric)}」の生点ランキングです。カード内にはスコアと偏差値を併記しています。年齢補正とSNS補正は使いません。
            {selectedMetric.isReference && ' 左右対称は角度や表情の影響が強いため参考値として見てください。'}
            {' '}肌スコアは全員75固定なので対象外です。
          </>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-slate-800/50 p-3">
        <span className="text-sm text-slate-400">補正:</span>

        <button
          onClick={() => setUseAge(!useAge)}
          disabled={!usesOverallScore}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            usesOverallScore
              ? useAge
                ? 'bg-amber-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              : 'cursor-not-allowed bg-slate-800 text-slate-600'
          }`}
        >
          <span className={`inline-block h-3 w-3 rounded-sm border ${
            usesOverallScore && useAge ? 'border-white bg-white' : 'border-slate-500'
          }`}>
            {usesOverallScore && useAge && (
              <span className="block text-center text-xs font-bold leading-3 text-amber-600">✓</span>
            )}
          </span>
          年齢
        </button>

        <button
          onClick={() => setUseSns(!useSns)}
          disabled={!usesOverallScore}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            usesOverallScore
              ? useSns
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              : 'cursor-not-allowed bg-slate-800 text-slate-600'
          }`}
        >
          <span className={`inline-block h-3 w-3 rounded-sm border ${
            usesOverallScore && useSns ? 'border-white bg-white' : 'border-slate-500'
          }`}>
            {usesOverallScore && useSns && (
              <span className="block text-center text-xs font-bold leading-3 text-emerald-600">✓</span>
            )}
          </span>
          SNS影響力
        </button>

        <span className="text-xs text-slate-500">
          {!usesOverallScore && `${selectedMetric.label}の単体ランキング`}
          {usesOverallScore && !useAge && !useSns && '顔の比率のみ'}
          {usesOverallScore && useAge && !useSns && '20代前半ピークで年齢補正'}
          {usesOverallScore && !useAge && useSns && '顔 70% + SNS 30%'}
          {usesOverallScore && useAge && useSns && '顔 70% + SNS 30% + 年齢補正'}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Data</div>
          <div className="mt-1 text-xl font-semibold text-white sm:text-2xl">{summary.total}</div>
          <div className="text-xs text-slate-500">表示データ数</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Age</div>
          <div className="mt-1 text-xl font-semibold text-white sm:text-2xl">{summary.ageCount}</div>
          <div className="text-xs text-slate-500">年齢データあり</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Average</div>
          <div className="mt-1 text-xl font-semibold text-white sm:text-2xl">
            {formatAgeStat(summary.averageAge)}
          </div>
          <div className="text-xs text-slate-500">平均年齢</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Median</div>
          <div className="mt-1 text-xl font-semibold text-white sm:text-2xl">
            {formatAgeStat(summary.medianAge)}
          </div>
          <div className="text-xs text-slate-500">中央値</div>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400">読み込み中...</div>
      ) : sorted.length === 0 ? (
        <div className="py-12 text-center text-slate-400">データがありません</div>
      ) : (
        <>
          <div className="space-y-2.5 sm:space-y-3">
            {paged.map((celeb, i) => (
              <CelebrityCard
                key={celeb.id}
                celebrity={celeb}
                rank={rankOffset + i + 1}
                metric={rankingMetric}
                metricDeviation={
                  isOverallMetric(rankingMetric)
                    ? null
                    : toMetricDeviation(
                        rankingMetric,
                        getRankingMetricValue(celeb, rankingMetric, false, false)
                      )
                }
                useAge={useAge}
                useSns={useSns}
                formatFollowers={formatFollowers}
                toDeviation={toDeviation}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => {
                  setPage((p) => Math.max(1, p - 1));
                  window.scrollTo(0, 0);
                }}
                disabled={page === 1}
                className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {'<'}
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPage(p);
                    window.scrollTo(0, 0);
                  }}
                  className={`h-9 w-9 rounded text-sm font-medium transition-colors ${
                    page === p
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => {
                  setPage((p) => Math.min(totalPages, p + 1));
                  window.scrollTo(0, 0);
                }}
                disabled={page === totalPages}
                className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
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
