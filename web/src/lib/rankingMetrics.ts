import type { Celebrity } from '../types/celebrity';

export type DetailRankingMetric =
  | 'golden_ratio'
  | 'eyes'
  | 'nose'
  | 'mouth'
  | 'contour'
  | 'symmetry';

export type RankingMetric = 'overall' | DetailRankingMetric;

export interface RankingMetricOption {
  value: RankingMetric;
  label: string;
  description: string;
  isReference?: boolean;
}

interface MetricDistributionGuide {
  cause: string;
  readingHint: string;
}

export const rankingMetricOptions: RankingMetricOption[] = [
  { value: 'overall', label: '総合', description: '総合スコア順' },
  { value: 'golden_ratio', label: '黄金比', description: '縦横比と配置' },
  { value: 'eyes', label: '目', description: '目の形と開き' },
  {
    value: 'nose',
    label: '鼻',
    description: '鼻の比率',
    isReference: true,
  },
  { value: 'mouth', label: '口', description: '口元の比率' },
  {
    value: 'contour',
    label: '輪郭',
    description: '輪郭の形',
    isReference: true,
  },
  {
    value: 'symmetry',
    label: '左右対称',
    description: '左右のそろい方',
    isReference: true,
  },
];

const metricDistributionGuides: Record<DetailRankingMetric, MetricDistributionGuide> = {
  golden_ratio: {
    cause:
      'いくつかの比率をまとめているので、中間に集まりやすいです。',
    readingHint:
      '細かい点差より、上位と下位の差を見ます。',
  },
  eyes: {
    cause:
      '表情、前髪、影で動きやすい指標です。',
    readingHint:
      '笑顔や伏し目も混ざるので、そのつもりで見ます。',
  },
  nose: {
    cause:
      '角度と光で見え方が変わりやすいです。',
    readingHint:
      '単独順位より、だいたいの傾向を見る指標です。',
  },
  mouth: {
    cause:
      '真顔か笑顔かでかなり動きます。',
    readingHint:
      '真顔と笑顔が混ざるので、そのつもりで見ます。',
  },
  contour: {
    cause:
      '骨格そのものではなく、写真に写った下顔面を見ています。',
    readingHint:
      '単独順位より、目安として見るのが合っています。',
  },
  symmetry: {
    cause:
      '正面度と表情の影響がかなり大きいです。',
    readingHint:
      '正面写真向けの参考値です。',
  },
};

export function isOverallMetric(metric: RankingMetric): metric is 'overall' {
  return metric === 'overall';
}

export function isReferenceMetric(metric: RankingMetric): boolean {
  return rankingMetricOptions.find((option) => option.value === metric)?.isReference ?? false;
}

export function getRankingMetricLabel(metric: RankingMetric): string {
  return rankingMetricOptions.find((option) => option.value === metric)?.label ?? metric;
}

export function getMetricDistributionGuide(metric: DetailRankingMetric): MetricDistributionGuide {
  return metricDistributionGuides[metric];
}

export function getOverallScore(celebrity: Celebrity, useAge: boolean, useSns: boolean): number {
  if (!celebrity.scores) return celebrity.score ?? 0;
  if (useAge && useSns) return celebrity.scores.faceAgeSns;
  if (useAge) return celebrity.scores.faceAge;
  if (useSns) return celebrity.scores.faceSns;
  return celebrity.scores.face;
}

export function getRankingMetricValue(
  celebrity: Celebrity,
  metric: RankingMetric,
  useAge: boolean,
  useSns: boolean
): number {
  if (isOverallMetric(metric)) {
    return getOverallScore(celebrity, useAge, useSns);
  }

  return celebrity.details?.[metric] ?? Number.NEGATIVE_INFINITY;
}
