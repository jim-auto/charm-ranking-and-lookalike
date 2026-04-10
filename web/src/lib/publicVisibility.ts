import type { Celebrity } from '../types/celebrity';

export const MAX_PUBLIC_AGE = 39;

export function isPublicSiteCelebrityVisible(celebrity: Pick<Celebrity, 'age'>): boolean {
  return typeof celebrity.age === 'number' && celebrity.age <= MAX_PUBLIC_AGE;
}

export function filterPublicSiteCelebrities<T extends Pick<Celebrity, 'age'>>(
  celebrities: T[],
): T[] {
  return celebrities.filter(isPublicSiteCelebrityVisible);
}
