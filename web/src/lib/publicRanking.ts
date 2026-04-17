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
  橋本環奈: 8.5,
  浜辺美波: 12.0,
  今田美桜: 1.0,
  石原さとみ: 5.0,
  新垣結衣: 10.0,
  長澤まさみ: 9.0,
  北川景子: 9.0,
  広瀬すず: 8.0,
  広瀬アリス: 7.0,
  有村架純: 8.0,
  川口春奈: 7.0,
  二階堂ふみ: 3.0,
  上白石萌音: 3.0,
  福原遥: 3.0,
  桜田ひより: 2.5,
  芳根京子: 5.0,
  梅澤美波: 2.0,
  山下美月: 2.0,
  佐藤健: 7.0,
  菅田将暉: 8.0,
  竹内涼真: 9.0,
  岡田将生: 9.0,
  横浜流星: 7.0,
  渡邉理佐: -2.5,
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
  小野賢章: -3.0,
  高野人母美: -2.0,
  高城亜樹: -1.0,
  河口夏音: -2.5,
  鉢嶺杏奈: -2.0,
  喜多村英梨: -4.0,
  早見沙織: -3.0,
  和泉崇司: -2.5,
  細田善彦: -1.0,
  田中瞳: -0.5,
  児島真理奈: -1.0,
  真理奈: -1.0,
  冨田菜々風: -2.0,
  赤井沙希: -2.5,
  谷崎早耶: -2.0,
  山谷花純: -2.0,
  吉沢亮: 1.5,
  成田凌: -1.0,
  永野芽郁: -2.5,
  山崎賢人: 4.5,
  山田裕貴: 2.5,
  森七菜: 2.5,
  齋藤飛鳥: 1.0,
  平野紫耀: 3.0,
  向井康二: -1.5,
  佐藤勝利: -1.5,
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
