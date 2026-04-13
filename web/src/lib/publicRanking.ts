import type { Celebrity } from '../types/celebrity';
import {
  convertCelebrityDeviationToGeneralDeviation,
} from './metricDistribution';

const PUBLIC_CATEGORY_PENALTIES: Record<string, number> = {
  youtuber: 5.0,
  influencer: 1.0,
  comedian: 2.0,
  artist: 3.5,
};

/** Editorial score adjustments for celebrities whose algorithmic score
 *  significantly diverges from public perception of attractiveness. */
const PUBLIC_SCORE_ADJUSTMENTS: Record<string, number> = {
  橋本環奈: 2.0,
  石原さとみ: 1.5,
  米津玄師: -4.0,
  あいみょん: -4.0,
  優里: 5.0,
  幾田りら: 6.0,
  'King Gnu井口理': 7.0,
  常田大希: 2.0,
  'Taka(ONE OK ROCK)': 4.0,
  西野カナ: 2.0,
  LiSA: 2.0,
  大森元貴: 7.0,
  ローラ: 5.0,
  藤田ニコル: -1.0,
  みちょぱ: 7.0,
  ゆきりぬ: 1.0,
  ゆうこす: 2.0,
  中島健人: 15.0,
};

export function getPublicRankingCategoryPenalty(category?: string): number {
  if (!category) return 0;
  return PUBLIC_CATEGORY_PENALTIES[category] ?? 0;
}

export function getPublicOverallScore(
  celebrity: Pick<Celebrity, 'name' | 'category' | 'scores' | 'score'>,
  useSns: boolean,
): number {
  const baseScore = celebrity.scores
    ? useSns
      ? celebrity.scores.faceSns
      : celebrity.scores.face
    : celebrity.score ?? 0;
  const adjust = PUBLIC_SCORE_ADJUSTMENTS[celebrity.name] ?? 0;
  return baseScore + adjust - getPublicRankingCategoryPenalty(celebrity.category);
}

export function createPublicGeneralScoreDeviationConverter(
  _celebrities: Array<Pick<Celebrity, 'name' | 'category' | 'scores' | 'score'>>,
  _useSns: boolean,
): (rawScore: number) => number {
  return (rawScore: number) => {
    const celebrityDeviation = 50 + 10 * ((rawScore - 47.0) / 6.0);
    return convertCelebrityDeviationToGeneralDeviation(celebrityDeviation);
  };
}
