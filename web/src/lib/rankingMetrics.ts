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

export const rankingMetricOptions: RankingMetricOption[] = [
  { value: 'overall', label: '総合', description: '分布補正後の総合ランキング' },
  { value: 'golden_ratio', label: '黄金比', description: '顔の縦横比と目の配置' },
  { value: 'eyes', label: '目', description: '目の開き方と左右バランス' },
  {
    value: 'nose',
    label: '鼻',
    description: '鼻の幅と長さの比率。写真条件の影響が残る参考値',
    isReference: true,
  },
  { value: 'mouth', label: '口', description: '口幅と唇バランスの比率' },
  {
    value: 'contour',
    label: '輪郭',
    description: '顎幅比と顎先バランス、フェイスライン。角度の影響が残る参考値',
    isReference: true,
  },
  {
    value: 'symmetry',
    label: '左右対称',
    description: '写真条件の影響が強い参考値',
    isReference: true,
  },
];

export function isOverallMetric(metric: RankingMetric): metric is 'overall' {
  return metric === 'overall';
}

export function isReferenceMetric(metric: RankingMetric): boolean {
  return rankingMetricOptions.find((option) => option.value === metric)?.isReference ?? false;
}

export function getRankingMetricLabel(metric: RankingMetric): string {
  return rankingMetricOptions.find((option) => option.value === metric)?.label ?? metric;
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
