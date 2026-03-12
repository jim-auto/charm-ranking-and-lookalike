export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

export function findSimilarCelebrities(
  userEmbedding: number[],
  celebrities: { embedding: number[] }[],
  topN = 5,
): { index: number; similarity: number }[] {
  const similarities = celebrities.map((celeb, index) => ({
    index,
    similarity: cosineSimilarity(userEmbedding, celeb.embedding),
  }));

  similarities.sort((a, b) => b.similarity - a.similarity);
  return similarities.slice(0, topN);
}
