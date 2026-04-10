import type { Celebrity } from '../types/celebrity';

export const MAX_PUBLIC_AGE = 39;

export function isPublicSiteCelebrityVisible(
  celebrity: Pick<Celebrity, 'age' | 'rankingEligible'>,
): boolean {
  return (
    typeof celebrity.age === 'number' &&
    celebrity.age <= MAX_PUBLIC_AGE &&
    celebrity.rankingEligible !== false
  );
}

export function filterPublicSiteCelebrities<
  T extends Pick<Celebrity, 'age' | 'rankingEligible'>,
>(celebrities: T[]): T[] {
  return celebrities.filter(isPublicSiteCelebrityVisible);
}
