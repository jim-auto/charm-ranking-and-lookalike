import type { ScoreDetails } from '../types/celebrity';
import type { MetricDistribution } from './metricDistribution';
import type { PhotoQualityAssessment } from './photoQuality';
import type { DetailRankingMetric } from './rankingMetrics';

export interface DiagnoseCalibrationResult {
  details: ScoreDetails;
  reliability: Record<DetailRankingMetric, number>;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function toReliability(score: number): number {
  return round1(Math.max(0, Math.min(1, (score - 40) / 60)));
}

function getMetricMean(
  metric: DetailRankingMetric,
  distributions: Partial<Record<DetailRankingMetric, MetricDistribution>>,
): number {
  return distributions[metric]?.mean ?? 50;
}

function blendTowardMean(rawValue: number, meanValue: number, reliability: number): number {
  const preserveShare = 0.25 + reliability * 0.75;
  return round1(clamp(meanValue + (rawValue - meanValue) * preserveShare));
}

export function calibrateDiagnoseDetails(
  details: ScoreDetails,
  photoQuality: PhotoQualityAssessment,
  distributions: Partial<Record<DetailRankingMetric, MetricDistribution>>,
): DiagnoseCalibrationResult {
  const supportScores: Record<DetailRankingMetric, number> = {
    golden_ratio:
      photoQuality.frontalScore * 0.5 +
      photoQuality.cropScore * 0.35 +
      photoQuality.sharpnessScore * 0.15,
    eyes:
      photoQuality.frontalScore * 0.35 +
      photoQuality.sharpnessScore * 0.45 +
      photoQuality.cropScore * 0.2,
    nose:
      photoQuality.frontalScore * 0.55 +
      photoQuality.cropScore * 0.25 +
      photoQuality.sharpnessScore * 0.2,
    mouth:
      photoQuality.frontalScore * 0.45 +
      photoQuality.cropScore * 0.35 +
      photoQuality.sharpnessScore * 0.2,
  };

  const reliability: Record<DetailRankingMetric, number> = {
    golden_ratio: toReliability(supportScores.golden_ratio),
    eyes: toReliability(supportScores.eyes),
    nose: toReliability(supportScores.nose),
    mouth: toReliability(supportScores.mouth),
  };

  return {
    reliability,
    details: {
      ...details,
      golden_ratio: blendTowardMean(
        details.golden_ratio,
        getMetricMean('golden_ratio', distributions),
        reliability.golden_ratio,
      ),
      eyes: blendTowardMean(
        details.eyes,
        getMetricMean('eyes', distributions),
        reliability.eyes,
      ),
      nose: blendTowardMean(
        details.nose,
        getMetricMean('nose', distributions),
        reliability.nose,
      ),
      mouth: blendTowardMean(
        details.mouth,
        getMetricMean('mouth', distributions),
        reliability.mouth,
      ),
    },
  };
}
