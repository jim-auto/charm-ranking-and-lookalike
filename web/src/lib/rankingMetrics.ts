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

const metricDistributionGuides: Record<DetailRankingMetric, MetricDistributionGuide> = {
  golden_ratio: {
    cause:
      '複数の比率を合成しているので、中間帯に集まりやすく、極端に崩れた写真だけが低得点側へ外れやすいです。',
    readingHint:
      '総合との整合は比較的高めですが、数点差よりも上位帯と下位帯の大きな差を見るのが安全です。',
  },
  eyes: {
    cause:
      '目の開き、笑顔、片目の細まり、前髪や影のかかり方で数値が動くので、閉じ気味の写真が混じると低得点側に裾が出やすいです。',
    readingHint:
      '一瞬の表情差を拾いやすいので、単写真の数点差は過信せず、偏差値ベースで見るのが向いています。',
  },
  nose: {
    cause:
      '鼻は2D写真だと角度、陰影、レンズ距離で幅と長さの見え方が変わるので、斜め顔が混じると分布がぶれやすいです。',
    readingHint:
      '生点は写真条件の影響が残るので、単独の優劣より傾向確認用として使うのが安全です。',
  },
  mouth: {
    cause:
      '口幅、口角、唇の厚みは真顔か笑顔かで動くので、表情差が大きいデータでは分布が広がりやすいです。',
    readingHint:
      '笑顔写真が混じる前提で、上位下位の大きな差を見る用途に寄せるのが妥当です。',
  },
  contour: {
    cause:
      '輪郭は骨格そのものではなく下顔面の2D proxy なので、顎の上げ下げ、顔の向き、髪のかかり方で分布が歪みやすいです。',
    readingHint:
      'raw は写真依存が残るので、偏差値主表示で見つつ、単独ランキングは参考値として読むのが妥当です。',
  },
  symmetry: {
    cause:
      '左右対称は正面度、表情、片目の開き差、影の入り方に強く引っ張られるので、単写真では最も歪みが出やすい指標です。',
    readingHint:
      '正面寄りで accepted の写真だけを対象にしても写真依存は残るので、参考値として扱うのが前提です。',
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
