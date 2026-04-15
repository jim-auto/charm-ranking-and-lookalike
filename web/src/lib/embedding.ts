export interface EmbeddingIndexEntry {
  index: number;
  name: string;
}

export interface EmbeddingVariantEntry {
  source?: string;
  embedding: number[];
}

export interface EmbeddingStore {
  count: number;
  dimension: number;
  indexById: Record<string, EmbeddingIndexEntry>;
  values: Float32Array;
  variantEmbeddingsById: Record<string, ArrayLike<number>[]>;
}

let embeddingStorePromise: Promise<EmbeddingStore> | null = null;

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchOptionalJson<T>(url: string, fallback: T): Promise<T> {
  const response = await fetch(url);
  if (response.status === 404) {
    return fallback;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function toVariantEmbeddings(
  variantEntries: Record<string, EmbeddingVariantEntry[]>,
  dimension: number,
): Record<string, ArrayLike<number>[]> {
  return Object.fromEntries(
    Object.entries(variantEntries).map(([celebrityId, entries]) => {
      const embeddings: ArrayLike<number>[] = [];
      for (const entry of entries) {
        if (Array.isArray(entry?.embedding) && entry.embedding.length === dimension) {
          embeddings.push(new Float32Array(entry.embedding));
        }
      }
      return [celebrityId, embeddings];
    }),
  );
}

export async function loadEmbeddingStore(dataBaseUrl: string): Promise<EmbeddingStore> {
  if (!embeddingStorePromise) {
    embeddingStorePromise = (async () => {
      const baseUrl = dataBaseUrl.endsWith('/') ? dataBaseUrl : `${dataBaseUrl}/`;
      const [indexById, buffer, variantEntries] = await Promise.all([
        fetchJson<Record<string, EmbeddingIndexEntry>>(`${baseUrl}embeddings_index.json`),
        fetch(`${baseUrl}embeddings.bin`).then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ${baseUrl}embeddings.bin: ${response.status}`);
          }
          return response.arrayBuffer();
        }),
        fetchOptionalJson<Record<string, EmbeddingVariantEntry[]>>(
          `${baseUrl}embedding_variants.json`,
          {},
        ),
      ]);

      if (buffer.byteLength < 8) {
        throw new Error('embeddings.bin is too small');
      }

      const header = new DataView(buffer, 0, 8);
      const count = header.getUint32(0, true);
      const dimension = header.getUint32(4, true);
      const expectedByteLength = 8 + count * dimension * Float32Array.BYTES_PER_ELEMENT;

      if (buffer.byteLength !== expectedByteLength) {
        throw new Error(
          `Unexpected embeddings.bin size: got ${buffer.byteLength}, expected ${expectedByteLength}`,
        );
      }

      return {
        count,
        dimension,
        indexById,
        values: new Float32Array(buffer, 8, count * dimension),
        variantEmbeddingsById: toVariantEmbeddings(variantEntries, dimension),
      };
    })().catch((error) => {
      embeddingStorePromise = null;
      throw error;
    });
  }

  return embeddingStorePromise!;
}

export function getCelebrityEmbedding(
  store: EmbeddingStore,
  celebrityId: string,
): Float32Array | null {
  const entry = store.indexById[celebrityId];
  if (!entry) return null;

  const start = entry.index * store.dimension;
  const end = start + store.dimension;

  if (start < 0 || end > store.values.length) {
    return null;
  }

  return store.values.subarray(start, end);
}

export function getCelebrityEmbeddings(
  store: EmbeddingStore,
  celebrityId: string,
): ArrayLike<number>[] {
  const mainEmbedding = getCelebrityEmbedding(store, celebrityId);
  const variantEmbeddings = store.variantEmbeddingsById[celebrityId] ?? [];
  return mainEmbedding ? [mainEmbedding, ...variantEmbeddings] : variantEmbeddings;
}

export function findSimilarCelebrities(
  userEmbedding: ArrayLike<number>,
  celebrities: { id: string }[],
  store: EmbeddingStore,
  topN = 5,
): { index: number; similarity: number }[] {
  const similarities: { index: number; similarity: number }[] = [];

  celebrities.forEach((celebrity, index) => {
    const candidateEmbeddings = getCelebrityEmbeddings(store, celebrity.id);
    if (candidateEmbeddings.length === 0) {
      return;
    }

    let bestSimilarity = -Infinity;
    for (const embedding of candidateEmbeddings) {
      if (embedding.length !== userEmbedding.length) {
        continue;
      }
      bestSimilarity = Math.max(bestSimilarity, cosineSimilarity(userEmbedding, embedding));
    }

    if (!Number.isFinite(bestSimilarity)) {
      return;
    }

    similarities.push({
      index,
      similarity: bestSimilarity,
    });
  });

  similarities.sort((a, b) => b.similarity - a.similarity);
  return similarities.slice(0, topN);
}

export function findSimilarCelebritiesByAnyEmbedding(
  userEmbeddings: ArrayLike<number>[],
  celebrities: { id: string }[],
  store: EmbeddingStore,
  topN = 5,
): { index: number; similarity: number }[] {
  const similarities: { index: number; similarity: number }[] = [];

  celebrities.forEach((celebrity, index) => {
    const candidateEmbeddings = getCelebrityEmbeddings(store, celebrity.id);
    if (candidateEmbeddings.length === 0) {
      return;
    }

    let bestSimilarity = -Infinity;
    for (const userEmbedding of userEmbeddings) {
      for (const embedding of candidateEmbeddings) {
        if (embedding.length !== userEmbedding.length) {
          continue;
        }
        bestSimilarity = Math.max(bestSimilarity, cosineSimilarity(userEmbedding, embedding));
      }
    }

    if (!Number.isFinite(bestSimilarity)) {
      return;
    }

    similarities.push({
      index,
      similarity: bestSimilarity,
    });
  });

  similarities.sort((a, b) => b.similarity - a.similarity);
  return similarities.slice(0, topN);
}
