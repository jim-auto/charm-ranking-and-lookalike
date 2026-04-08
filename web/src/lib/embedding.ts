export interface EmbeddingIndexEntry {
  index: number;
  name: string;
}

export interface EmbeddingStore {
  count: number;
  dimension: number;
  indexById: Record<string, EmbeddingIndexEntry>;
  values: Float32Array;
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

export async function loadEmbeddingStore(dataBaseUrl: string): Promise<EmbeddingStore> {
  if (!embeddingStorePromise) {
    embeddingStorePromise = (async () => {
      const baseUrl = dataBaseUrl.endsWith('/') ? dataBaseUrl : `${dataBaseUrl}/`;
      const [indexById, buffer] = await Promise.all([
        fetchJson<Record<string, EmbeddingIndexEntry>>(`${baseUrl}embeddings_index.json`),
        fetch(`${baseUrl}embeddings.bin`).then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ${baseUrl}embeddings.bin: ${response.status}`);
          }
          return response.arrayBuffer();
        }),
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
      };
    })().catch((error) => {
      embeddingStorePromise = null;
      throw error;
    });
  }

  return embeddingStorePromise;
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

export function findSimilarCelebrities(
  userEmbedding: ArrayLike<number>,
  celebrities: { id: string }[],
  store: EmbeddingStore,
  topN = 5,
): { index: number; similarity: number }[] {
  const similarities: { index: number; similarity: number }[] = [];

  celebrities.forEach((celebrity, index) => {
    const embedding = getCelebrityEmbedding(store, celebrity.id);
    if (!embedding || embedding.length !== userEmbedding.length) {
      return;
    }

    similarities.push({
      index,
      similarity: cosineSimilarity(userEmbedding, embedding),
    });
  });

  similarities.sort((a, b) => b.similarity - a.similarity);
  return similarities.slice(0, topN);
}
