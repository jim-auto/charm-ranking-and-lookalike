import {
  getRankingMetricLabel,
  type DetailRankingMetric,
} from '../lib/rankingMetrics';
import type { MetricDistribution } from '../lib/metricDistribution';

interface Props {
  distributions: Partial<Record<DetailRankingMetric, MetricDistribution>>;
}

const metricOrder: DetailRankingMetric[] = [
  'golden_ratio',
  'eyes',
  'nose',
  'mouth',
  'contour',
  'symmetry',
];

function describeDistribution(distribution: MetricDistribution): {
  label: string;
  tone: string;
} {
  const lowBucketShare =
    distribution.count > 0 ? distribution.histogram[0].count / distribution.count : 0;
  const spread = distribution.p90 - distribution.p10;

  if (lowBucketShare >= 0.45) {
    return {
      label: '低得点側に偏り',
      tone: 'border-amber-800/70 bg-amber-950/30 text-amber-200',
    };
  }

  if (spread <= 12) {
    return {
      label: 'レンジ圧縮',
      tone: 'border-orange-800/70 bg-orange-950/30 text-orange-200',
    };
  }

  if (distribution.skew >= 0.8) {
    return {
      label: '高得点側に裾',
      tone: 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200',
    };
  }

  if (distribution.skew <= -0.8) {
    return {
      label: '低得点側に裾',
      tone: 'border-sky-800/70 bg-sky-950/30 text-sky-200',
    };
  }

  return {
    label: '比較的安定',
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
    <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white sm:text-base">各指標の分布</h3>
        <p className="mt-1 text-xs text-slate-400 sm:text-sm">
          現在の表示条件に絞った raw スコア分布です。raw の平均は 50 に揃えていないので、比較は偏差値ベースで見る前提です。
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {metrics.map(({ metric, distribution }) => {
          const status = describeDistribution(distribution);
          const maxCount = Math.max(...distribution.histogram.map((bin) => bin.count), 1);

          return (
            <div
              key={metric}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">
                    {getRankingMetricLabel(metric)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    n={distribution.count} / p10-p90 {formatValue(distribution.p10)}-
                    {formatValue(distribution.p90)}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.tone}`}
                >
                  {status.label}
                </span>
              </div>

              <div className="mb-3 grid grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-slate-500">平均</div>
                  <div className="mt-0.5 font-medium text-slate-100">
                    {formatValue(distribution.mean)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">中央値</div>
                  <div className="mt-0.5 font-medium text-slate-100">
                    {formatValue(distribution.median)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">標準偏差</div>
                  <div className="mt-0.5 font-medium text-slate-100">
                    {formatValue(distribution.stdev)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">歪度</div>
                  <div className="mt-0.5 font-medium text-slate-100">
                    {formatValue(distribution.skew)}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                {distribution.histogram.map((bin) => (
                  <div key={bin.label}>
                    <div className="mb-0.5 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{bin.label}</span>
                      <span>{bin.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${(bin.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
