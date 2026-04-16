import type { Celebrity } from '../types/celebrity';
import {
  convertCelebrityDeviationToGeneralDeviation,
} from './metricDistribution';

const PUBLIC_CATEGORY_PENALTIES: Record<string, number> = {
  announcer: 0.5,
  voiceactor: 4.0,
  model: 1.5,
  idol: 0.5,
  business: 8.0,
  politician: 8.0,
  shogi: 6.0,
  youtuber: 8.0,
  influencer: 2.0,
  comedian: 6.0,
  artist: 4.5,
  cultural: 8.0,
  prowrestler: 6.0,
  musician: 4.0,
  athlete: 4.0,
};

/** Editorial score adjustments for celebrities whose algorithmic score
 *  significantly diverges from public perception of attractiveness. */
const PUBLIC_SCORE_ADJUSTMENTS: Record<string, number> = {
  橋本環奈: 6.5,
  石原さとみ: 2.5,
  米津玄師: -4.0,
  あいみょん: -4.0,
  優里: 8.0,
  藤井風: 4.0,
  幾田りら: 11.0,
  'King Gnu井口理': 12.0,
  常田大希: 2.0,
  'Taka(ONE OK ROCK)': 4.0,
  西野カナ: 8.0,
  LiSA: 7.0,
  大森元貴: 7.0,
  ローラ: 5.0,
  藤田ニコル: -1.0,
  みちょぱ: 7.0,
  ゆきりぬ: 1.0,
  ゆうこす: 2.0,
  中島健人: 15.0,
  Vaundy: -3.0,
  'EXIT りんたろー。': -5.0,
  'back number清水依与吏': -3.0,
  小野賢章: -1.0,
  高野人母美: -2.0,
  高城亜樹: -1.0,
  河口夏音: -1.0,
  鉢嶺杏奈: -1.0,
  喜多村英梨: -1.0,
  和泉崇司: -1.0,
  細田善彦: -1.0,
  田中瞳: -0.5,
  児島真理奈: -1.0,
  真理奈: -1.0,
  吉沢亮: 1.5,
  成田凌: 1.0,
  永野芽郁: 1.5,
  山崎賢人: 2.5,
  山田裕貴: 2.5,
  森七菜: 2.5,
  齋藤飛鳥: 1.0,
  平野紫耀: 1.0,
  向井康二: -3.0,
  佐藤勝利: -3.0,
  生見愛瑠: 4.5,
  松坂桃李: 3.0,
  神木隆之介: 3.0,
  窪田正孝: 2.0,
  佐野勇斗: 2.5,
  宮世琉弥: 2.5,
  ['稲葉浩志']: -2.0,
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
