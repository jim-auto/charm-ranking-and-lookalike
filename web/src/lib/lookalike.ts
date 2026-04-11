import type { Celebrity, ScoreDetails } from '../types/celebrity';

const DETAIL_WEIGHTS = {
  golden_ratio: 0.4,
  eyes: 0.2,
  nose: 0.2,
  mouth: 0.2,
} as const;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function calculateLookalikeSimilarity(
  userDetails: ScoreDetails,
  userScore: number,
  celebrity: Pick<Celebrity, 'details' | 'scores' | 'score'>,
): number {
  const detailSimilarity = Object.entries(DETAIL_WEIGHTS).reduce((sum, [key, weight]) => {
    const typedKey = key as keyof typeof DETAIL_WEIGHTS;
    const userValue = userDetails[typedKey];
    const celebrityValue = celebrity.details?.[typedKey];
    if (typeof userValue !== 'number' || typeof celebrityValue !== 'number') {
      return sum;
    }
    const closeness = clamp(100 - Math.abs(userValue - celebrityValue));
    return sum + closeness * weight;
  }, 0);

  const celebrityScore = celebrity.scores?.face ?? celebrity.score ?? 0;
  const scoreSimilarity = clamp(100 - Math.abs(userScore - celebrityScore) * 1.5);

  return round1(detailSimilarity * 0.8 + scoreSimilarity * 0.2);
}

export function cosineToSimilarityPercent(cosineSimilarity: number): number {
  return round1(clamp((cosineSimilarity + 1) * 50));
}

export function calculateHybridLookalikeSimilarity(
  userDetails: ScoreDetails,
  userScore: number,
  celebrity: Pick<Celebrity, 'details' | 'scores' | 'score'>,
  embeddingCosineSimilarity?: number | null,
): number {
  const detailSimilarity = calculateLookalikeSimilarity(userDetails, userScore, celebrity);
  if (embeddingCosineSimilarity == null) {
    return detailSimilarity;
  }

  const embeddingSimilarity = cosineToSimilarityPercent(embeddingCosineSimilarity);
  return round1(embeddingSimilarity * 0.7 + detailSimilarity * 0.3);
}

export function findSimilarCelebritiesByDetails(
  userDetails: ScoreDetails,
  userScore: number,
  celebrities: Array<Pick<Celebrity, 'id' | 'details' | 'scores' | 'score'>>,
  topN = 5,
): { index: number; similarity: number }[] {
  return celebrities
    .map((celebrity, index) => ({
      index,
      similarity: calculateLookalikeSimilarity(userDetails, userScore, celebrity),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}
