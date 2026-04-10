import type { Celebrity, ScoreDetails } from '../types/celebrity';
import type { DetailRankingMetric } from './rankingMetrics';

export interface HistogramBin {
  label: string;
  count: number;
}

export interface MetricDistribution {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdev: number;
  p10: number;
  p90: number;
  skew: number;
  histogram: HistogramBin[];
}

type ScoreKey = 'face' | 'faceAge' | 'faceSns' | 'faceAgeSns';

const GENERAL_DEVIATION_BASE = 55;
const GENERAL_DEVIATION_STRETCH = 1.3;
const GENERAL_DEVIATION_MIN = 35;
const GENERAL_DEVIATION_MAX = 99;

const DETAIL_METRICS: DetailRankingMetric[] = [
  'golden_ratio',
  'eyes',
  'nose',
  'mouth',
];

const OVERALL_METRICS: DetailRankingMetric[] = [
  'golden_ratio',
  'eyes',
  'nose',
  'mouth',
];

const OVERALL_WEIGHTS: Record<DetailRankingMetric, number> = {
  golden_ratio: 0.4,
  eyes: 0.2,
  nose: 0.2,
  mouth: 0.2,
};

const HISTOGRAM_BINS = [
  { min: 0, max: 19, label: '0-19' },
  { min: 20, max: 39, label: '20-39' },
  { min: 40, max: 59, label: '40-59' },
  { min: 60, max: 79, label: '60-79' },
  { min: 80, max: 100, label: '80-100' },
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];

  const lowerWeight = upper - index;
  const upperWeight = index - lower;
  return sortedValues[lower] * lowerWeight + sortedValues[upper] * upperWeight;
}

function createDeviationConverter(values: number[]): (rawValue: number) => number {
  const count = values.length;
  if (count === 0) return () => 50;

  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const stdev = Math.sqrt(variance);

  if (stdev === 0) return () => 50;

  return (rawValue: number) => round1(50 + 10 * ((rawValue - mean) / stdev));
}

export function convertCelebrityDeviationToGeneralDeviation(
  celebrityDeviation: number,
): number {
  const lifted =
    GENERAL_DEVIATION_BASE + (celebrityDeviation - 50) * GENERAL_DEVIATION_STRETCH;
  return round1(clamp(lifted, GENERAL_DEVIATION_MIN, GENERAL_DEVIATION_MAX));
}

export function createDeviationConverterFromValues(
  values: number[],
): (rawValue: number) => number {
  return createDeviationConverter(values);
}

function buildHistogram(values: number[]): HistogramBin[] {
  return HISTOGRAM_BINS.map((bin) => ({
    label: bin.label,
    count: values.filter((value) => value >= bin.min && value <= bin.max).length,
  }));
}

function getMetricValues(
  celebrities: Array<Pick<Celebrity, 'details'>>,
  metric: DetailRankingMetric,
): number[] {
  return celebrities
    .map((celebrity) => celebrity.details?.[metric])
    .filter((value): value is number => typeof value === 'number')
    .map((value) => Number(value));
}

export function createCelebrityScoreDeviationConverter(
  celebrities: Celebrity[],
  key: ScoreKey,
): (rawScore: number) => number {
  const values = celebrities.map((celebrity) => celebrity.scores?.[key] ?? celebrity.score ?? 0);
  return createDeviationConverter(values);
}

export function createGeneralScoreDeviationConverter(
  celebrities: Celebrity[],
  key: ScoreKey,
): (rawScore: number) => number {
  const celebrityConverter = createCelebrityScoreDeviationConverter(celebrities, key);
  return (rawScore: number) =>
    convertCelebrityDeviationToGeneralDeviation(celebrityConverter(rawScore));
}

export function calculateMetricDistributions(
  celebrities: Array<Pick<Celebrity, 'details'>>,
): Partial<Record<DetailRankingMetric, MetricDistribution>> {
  const distributions: Partial<Record<DetailRankingMetric, MetricDistribution>> = {};

  DETAIL_METRICS.forEach((metric) => {
    const values = getMetricValues(celebrities, metric);
    if (values.length === 0) return;

    const sortedValues = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const stdev = Math.sqrt(variance);
    const skew =
      stdev > 0
        ? values.reduce((sum, value) => sum + ((value - mean) / stdev) ** 3, 0) / values.length
        : 0;

    distributions[metric] = {
      count: values.length,
      min: sortedValues[0],
      max: sortedValues[sortedValues.length - 1],
      mean: round1(mean),
      median: round1(percentile(sortedValues, 0.5)),
      stdev: round1(stdev),
      p10: round1(percentile(sortedValues, 0.1)),
      p90: round1(percentile(sortedValues, 0.9)),
      skew: round1(skew),
      histogram: buildHistogram(values),
    };
  });

  return distributions;
}

export function calculateMetricDeviation(
  rawValue: number,
  distribution?: MetricDistribution | null,
): number | null {
  if (!distribution) return null;
  if (distribution.stdev === 0) return 50;

  const deviation = 50 + 10 * ((rawValue - distribution.mean) / distribution.stdev);
  return round1(clamp(deviation, 20, 80));
}

export function calculateAdjustedOverallScore(
  details: ScoreDetails,
  distributions: Partial<Record<DetailRankingMetric, MetricDistribution>>,
): number {
  let total = 0;

  OVERALL_METRICS.forEach((metric) => {
    const rawValue = details[metric];
    const deviation = calculateMetricDeviation(rawValue, distributions[metric]) ?? 50;
    total += deviation * OVERALL_WEIGHTS[metric];
  });

  return round1(total);
}
