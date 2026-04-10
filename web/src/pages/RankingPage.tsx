import { useEffect, useMemo, useState } from 'react';
import type { Celebrity } from '../types/celebrity';
import {
  type DetailRankingMetric,
  getRankingMetricValue,
  isOverallMetric,
  rankingMetricOptions,
  type RankingMetric,
} from '../lib/rankingMetrics';
import CelebrityCard from '../components/CelebrityCard';
import MetricDistributionPanel from '../components/MetricDistributionPanel';
import ScoreBreakdown from '../components/ScoreBreakdown';
import {
  calculateMetricDeviation,
  calculateMetricDistributions,
  createCelebrityScoreDeviationConverter,
} from '../lib/metricDistribution';

const genderFilters = [
  { value: '', label: 'すべて' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
];

const rankingScopes = [
  { value: 'recommended', label: 'おすすめ表示' },
  { value: 'all', label: '全カテゴリ' },
] as const;

const ageRanges = [
  { value: 'u40', label: 'U40' },
  { value: 'all', label: '全年代' },
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
type AgeRange = (typeof ageRanges)[number]['value'];

function filterRecommendedEntries(celebrities: Celebrity[]): Celebrity[] {
  let list = celebrities.filter((celebrity) => celebrity.faceValidationStatus !== 'rejected');
  list = list.filter((celebrity) => celebrity.rankingEligible !== false);
  return list;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
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
  const [ageRange, setAgeRange] = useState<AgeRange>('u40');
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
  }, [rankingScope, rankingMetric, genderFilter, categoryFilter, searchQuery, ageRange, useSns]);

  const allMetricDistributions = useMemo(
    () => calculateMetricDistributions(celebrities),
    [celebrities]
  );

  const toDeviation = useMemo(() => {
    if (celebrities.length === 0) return (_score: number, _sns: boolean) => 0;
    const convFace = createCelebrityScoreDeviationConverter(celebrities, 'face');
    const convFaceSns = createCelebrityScoreDeviationConverter(celebrities, 'faceSns');
    return (score: number, sns: boolean) => {
      if (sns) return convFaceSns(score);
      return convFace(score);
    };
  }, [celebrities]);

  const toMetricDeviation = useMemo(() => {
    return (metric: DetailRankingMetric, rawValue: number) =>
      calculateMetricDeviation(rawValue, allMetricDistributions[metric]);
  }, [allMetricDistributions]);

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

  const selectedMetric = useMemo(
    () => rankingMetricOptions.find((option) => option.value === rankingMetric) ?? rankingMetricOptions[0],
    [rankingMetric]
  );
  const usesOverallScore = isOverallMetric(rankingMetric);

  const sorted = useMemo(() => {
    let list =
      rankingScope === 'recommended'
        ? filterRecommendedEntries(celebrities)
        : celebrities.filter((celebrity) => celebrity.faceValidationStatus !== 'rejected');
    if (genderFilter) list = list.filter((c) => c.gender === genderFilter);
    if (categoryFilter) list = list.filter((c) => c.category === categoryFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.group && c.group.toLowerCase().includes(q))
      );
    }
    if (ageRange === 'u40') {
      list = list.filter((celebrity) => typeof celebrity.age === 'number' && celebrity.age <= 39);
    }
    if (!usesOverallScore) {
      list = list.filter((celebrity) => typeof celebrity.details?.[rankingMetric] === 'number');
    }
    list.sort((a, b) => {
      const aValue = getRankingMetricValue(a, rankingMetric, false, useSns);
      const bValue = getRankingMetricValue(b, rankingMetric, false, useSns);
      return bValue - aValue;
    });
    return list;
  }, [
    celebrities,
    rankingScope,
    rankingMetric,
    genderFilter,
    categoryFilter,
    searchQuery,
    ageRange,
    useSns,
  ]);

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

  const filteredMetricDistributions = useMemo(
    () => calculateMetricDistributions(sorted),
    [sorted]
  );

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
        <span className="mr-1 text-sm text-slate-400">年代:</span>
        {ageRanges.map((range) => (
          <button
            key={range.value}
            onClick={() => setAgeRange(range.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              ageRange === range.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {range.label}
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
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={metric.description}
          >
            {metric.label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-slate-800/50 p-3">
        <span className="text-sm text-slate-400">条件:</span>

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
          {usesOverallScore && ageRange === 'u40' && !useSns && 'U40 / 4指標'}
          {usesOverallScore && ageRange === 'all' && !useSns && '全年代 / 4指標'}
          {usesOverallScore && ageRange === 'u40' && useSns && 'U40 / 4指標 70% + SNS 30%'}
          {usesOverallScore && ageRange === 'all' && useSns && '全年代 / 4指標 70% + SNS 30%'}
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

      <MetricDistributionPanel distributions={filteredMetricDistributions} />

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
