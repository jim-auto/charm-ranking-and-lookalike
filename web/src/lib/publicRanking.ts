import type { Celebrity } from '../types/celebrity';
import {
  convertCelebrityDeviationToGeneralDeviation,
  createDeviationConverterFromValues,
} from './metricDistribution';

const PUBLIC_CATEGORY_PENALTIES: Record<string, number> = {
  youtuber: 7.0,
  influencer: 3.0,
  comedian: 4.0,
  artist: 3.5,
};

export function getPublicRankingCategoryPenalty(category?: string): number {
  if (!category) return 0;
  return PUBLIC_CATEGORY_PENALTIES[category] ?? 0;
}

export function getPublicOverallScore(
  celebrity: Pick<Celebrity, 'category' | 'scores' | 'score'>,
  useSns: boolean,
): number {
  const baseScore = celebrity.scores
    ? useSns
      ? celebrity.scores.faceSns
      : celebrity.scores.face
    : celebrity.score ?? 0;
  return baseScore - getPublicRankingCategoryPenalty(celebrity.category);
}

export function createPublicGeneralScoreDeviationConverter(
  celebrities: Array<Pick<Celebrity, 'category' | 'scores' | 'score'>>,
  useSns: boolean,
): (rawScore: number) => number {
  const values = celebrities.map((celebrity) => getPublicOverallScore(celebrity, useSns));
  const celebrityDeviation = createDeviationConverterFromValues(values);
  return (rawScore: number) =>
    convertCelebrityDeviationToGeneralDeviation(celebrityDeviation(rawScore));
}
