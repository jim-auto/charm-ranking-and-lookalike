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
    cause: '複数比率の合成で中間に集まりやすい',
    readingHint: '細かい点差より帯で見る',
  },
  eyes: {
    cause: '表情、前髪、影で動きやすい',
    readingHint: '笑顔や伏し目も混ざる',
  },
  nose: {
    cause: '角度と光で見え方が変わる',
    readingHint: '単独順位より傾向を見る',
  },
  mouth: {
    cause: '真顔か笑顔かでかなり動く',
    readingHint: '真顔と笑顔が混ざる',
  },
  contour: {
    cause: '骨格そのものではなく下顔面の写りを見る',
    readingHint: '単独順位より目安向き',
  },
  symmetry: {
    cause: '正面度と表情の影響が大きい',
    readingHint: '正面写真向けの参考値',
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
