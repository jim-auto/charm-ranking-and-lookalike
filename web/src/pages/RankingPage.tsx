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
  createDeviationConverterFromValues,
} from '../lib/metricDistribution';
import { filterPublicSiteCelebrities } from '../lib/publicVisibility';
import {
  createPublicGeneralScoreDeviationConverter,
  getPublicOverallScore,
} from '../lib/publicRanking';

const genderFilters = [
  { value: '', label: 'すべて' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
];

const categoryLabels: Record<string, string> = {
  actor: '俳優',
  actress: '女優',
  idol: 'アイドル',
  model: 'モデル',
  announcer: 'アナウンサー',
  voiceactor: '声優',
  influencer: 'インフルエンサー',
  artist: 'アーティスト',
  athlete: 'アスリート',
  comedian: '芸人',
  shogi: '棋士',
  sumo: '力士',
  cultural: '文化人',
  business: '実業家',
  politician: '政治家',
  musician: 'ミュージシャン',
  prowrestler: 'プロレスラー',
  youtuber: 'YouTuber',
};

const categoryOrder = [
  'actor',
  'actress',
  'idol',
  'model',
  'announcer',
  'voiceactor',
  'influencer',
  'artist',
  'athlete',
  'comedian',
  'shogi',
  'sumo',
  'cultural',
  'business',
  'politician',
  'musician',
  'prowrestler',
  'youtuber',
];

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
  const [rankingMetric, setRankingMetric] = useState<RankingMetric>('overall');
  const [genderFilter, setGenderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
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
  }, [rankingMetric, genderFilter, categoryFilter, searchQuery, useSns]);

  const visibleCelebrities = useMemo(
    () =>
      filterPublicSiteCelebrities(celebrities).filter(
        (celebrity) => celebrity.faceValidationStatus !== 'rejected',
      ),
    [celebrities],
  );

  const allMetricDistributions = useMemo(
    () => calculateMetricDistributions(visibleCelebrities),
    [visibleCelebrities],
  );

  const toDeviation = useMemo(() => {
    if (visibleCelebrities.length === 0) return (_score: number, _sns: boolean) => 0;
    const converter = createPublicGeneralScoreDeviationConverter(visibleCelebrities, useSns);
    return (score: number, _sns: boolean) => converter(score);
  }, [visibleCelebrities, useSns]);

  const toCelebrityDeviation = useMemo(() => {
    if (visibleCelebrities.length === 0) return (_score: number) => 0;
    const values = visibleCelebrities.map((c) => getPublicOverallScore(c, useSns));
    return createDeviationConverterFromValues(values);
  }, [visibleCelebrities, useSns]);

  const toMetricDeviation = useMemo(
    () => (metric: DetailRankingMetric, rawValue: number) =>
      calculateMetricDeviation(rawValue, allMetricDistributions[metric]),
    [allMetricDistributions],
  );

  const categoryFilters = useMemo(() => {
    const values = Array.from(
      new Set(visibleCelebrities.map((c) => c.category).filter(Boolean)),
    ).sort(sortCategoryValues);
    return [
      { value: '', label: 'すべて' },
      ...values.map((value) => ({
        value,
        label: categoryLabels[value] ?? value,
      })),
    ];
  }, [visibleCelebrities]);

  const selectedMetric = useMemo(
    () =>
      rankingMetricOptions.find((option) => option.value === rankingMetric) ??
      rankingMetricOptions[0],
    [rankingMetric],
  );
  const usesOverallScore = isOverallMetric(rankingMetric);

  const sorted = useMemo(() => {
    let list = [...visibleCelebrities];

    if (genderFilter) list = list.filter((celebrity) => celebrity.gender === genderFilter);
    if (categoryFilter) list = list.filter((celebrity) => celebrity.category === categoryFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (celebrity) =>
          celebrity.name.toLowerCase().includes(q) ||
          (celebrity.group && celebrity.group.toLowerCase().includes(q)),
      );
    }
    if (!usesOverallScore) {
      list = list.filter((celebrity) => typeof celebrity.details?.[rankingMetric] === 'number');
    }

    list.sort((a, b) => {
      const aValue = usesOverallScore
        ? getPublicOverallScore(a, useSns)
        : getRankingMetricValue(a, rankingMetric, false, useSns);
      const bValue = usesOverallScore
        ? getPublicOverallScore(b, useSns)
        : getRankingMetricValue(b, rankingMetric, false, useSns);
      return bValue - aValue;
    });

    return list;
  }, [visibleCelebrities, genderFilter, categoryFilter, searchQuery, rankingMetric, useSns, usesOverallScore]);

  const summary = useMemo(() => {
    const ages = sorted
      .map((celebrity) => celebrity.age)
      .filter((age): age is number => typeof age === 'number');

    return {
      total: sorted.length,
      ageCount: ages.length,
      averageAge: ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : null,
      medianAge: median(ages),
    };
  }, [sorted]);

  const filteredMetricDistributions = useMemo(
    () => calculateMetricDistributions(sorted),
    [sorted],
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
        <span className="mr-1 text-sm text-slate-400">性別:</span>
        {genderFilters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setGenderFilter(filter.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              genderFilter === filter.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-slate-400">ジャンル:</span>
        {categoryFilters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setCategoryFilter(filter.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              categoryFilter === filter.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {filter.label}
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
        <span className="text-sm text-slate-400">設定:</span>

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
          <span
            className={`inline-block h-3 w-3 rounded-sm border ${
              usesOverallScore && useSns ? 'border-white bg-white' : 'border-slate-500'
            }`}
          >
            {usesOverallScore && useSns && (
              <span className="block text-center text-xs font-bold leading-3 text-emerald-600">
                ✓
              </span>
            )}
          </span>
          SNS補正
        </button>

        <span className="text-xs text-slate-500">
          {!usesOverallScore && `${selectedMetric.label}の単独ランキング`}
          {usesOverallScore && !useSns && '4指標'}
          {usesOverallScore && useSns && '4指標 70% + SNS 30%'}
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
          <div className="mt-1 text-xl font-semibold text-white sm:text-2xl">
            {summary.ageCount}
          </div>
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
            {paged.map((celebrity, index) => (
              <CelebrityCard
                key={celebrity.id}
                celebrity={celebrity}
                rank={rankOffset + index + 1}
                metric={rankingMetric}
                overallScoreOverride={
                  isOverallMetric(rankingMetric) ? getPublicOverallScore(celebrity, useSns) : undefined
                }
                metricDeviation={
                  isOverallMetric(rankingMetric)
                    ? null
                    : toMetricDeviation(
                        rankingMetric,
                        getRankingMetricValue(celebrity, rankingMetric, false, false),
                      )
                }
                useSns={useSns}
                formatFollowers={formatFollowers}
                toDeviation={toDeviation}
                toCelebrityDeviation={isOverallMetric(rankingMetric) ? toCelebrityDeviation : undefined}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => {
                  setPage((current) => Math.max(1, current - 1));
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
                  setPage((current) => Math.min(totalPages, current + 1));
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
