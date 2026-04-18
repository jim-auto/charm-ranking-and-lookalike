import { getRankingMetricLabel, type DetailRankingMetric } from '../lib/rankingMetrics';
import type { MetricDistribution } from '../lib/metricDistribution';

interface Props {
  distributions: Partial<Record<DetailRankingMetric, MetricDistribution>>;
}

const metricOrder: DetailRankingMetric[] = [
  'golden_ratio',
  'eyes',
  'nose',
  'mouth',
];

const metricTheme: Record<
  DetailRankingMetric,
  {
    dot: string;
    bar: string;
    panel: string;
  }
> = {
  golden_ratio: {
    dot: 'bg-amber-400',
    bar: 'bg-amber-400',
    panel: 'from-amber-500/10',
  },
  eyes: {
    dot: 'bg-violet-400',
    bar: 'bg-violet-400',
    panel: 'from-violet-500/10',
  },
  nose: {
    dot: 'bg-emerald-400',
    bar: 'bg-emerald-400',
    panel: 'from-emerald-500/10',
  },
  mouth: {
    dot: 'bg-pink-400',
    bar: 'bg-pink-400',
    panel: 'from-pink-500/10',
  },
};

function describeDistribution(distribution: MetricDistribution): {
  label: string;
  tone: string;
} {
  const lowBucketShare =
    distribution.count > 0 ? distribution.histogram[0].count / distribution.count : 0;
  const spread = distribution.p90 - distribution.p10;

  if (lowBucketShare >= 0.45) {
    return {
      label: '低得点寄り',
      tone: 'border-amber-800/70 bg-amber-950/40 text-amber-200',
    };
  }

  if (spread <= 12) {
    return {
      label: '差がつきにくい',
      tone: 'border-orange-800/70 bg-orange-950/40 text-orange-200',
    };
  }

  if (distribution.skew >= 0.8) {
    return {
      label: '高得点側に裾',
      tone: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-200',
    };
  }

  if (distribution.skew <= -0.8) {
    return {
      label: '低得点側に裾',
      tone: 'border-sky-800/70 bg-sky-950/40 text-sky-200',
    };
  }

  return {
    label: '分布は安定',
    tone: 'border-slate-700 bg-slate-900/80 text-slate-300',
  };
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function MetricDistributionPanel({ distributions }: Props) {
  const metrics = metricOrder
    .map((metric) => ({
      metric,
      distribution: distributions[metric],
    }))
    .filter(
      (
        entry
      ): entry is {
        metric: DetailRankingMetric;
        distribution: MetricDistribution;
      } => Boolean(entry.distribution)
    );

  if (metrics.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/65 p-4 sm:p-5">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white sm:text-base">各指標の分布</h3>
          <p className="mt-1 text-xs text-slate-500">生スコアの散らばり</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {metrics.map(({ metric, distribution }) => {
          const status = describeDistribution(distribution);
          const theme = metricTheme[metric];
          const maxCount = Math.max(...distribution.histogram.map((bin) => bin.count), 1);

          return (
            <article
              key={metric}
              className={`overflow-hidden rounded-2xl border border-slate-800 bg-linear-to-br ${theme.panel} to-slate-950/90 p-4`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${theme.dot}`} />
                    <h4 className="text-base font-semibold text-white">
                      {getRankingMetricLabel(metric)}
                    </h4>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    n={distribution.count} / p10-p90 {formatValue(distribution.p10)}-
                    {formatValue(distribution.p90)}
                  </div>
                </div>

                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${status.tone}`}
                >
                  {status.label}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Mean
                  </div>
                  <div className="mt-1 text-base font-semibold text-white">
                    {formatValue(distribution.mean)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Median
                  </div>
                  <div className="mt-1 text-base font-semibold text-white">
                    {formatValue(distribution.median)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">SD</div>
                  <div className="mt-1 text-base font-semibold text-white">
                    {formatValue(distribution.stdev)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Skew
                  </div>
                  <div className="mt-1 text-base font-semibold text-white">
                    {formatValue(distribution.skew)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-5 gap-2">
                {distribution.histogram.map((bin) => (
                  <div key={bin.label} className="min-w-0">
                    <div className="flex h-20 items-end rounded-xl border border-slate-800 bg-slate-950/80 p-1.5">
                      <div
                        className={`w-full rounded-md ${theme.bar}`}
                        style={{ height: `${Math.max((bin.count / maxCount) * 100, 6)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-center text-[10px] font-medium text-slate-400">
                      {bin.label}
                    </div>
                    <div className="text-center text-[10px] text-slate-500">{bin.count}</div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
