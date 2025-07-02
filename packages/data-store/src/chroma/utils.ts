import { type Collection } from 'chromadb';
import { type IVectorStoreDocument } from 'types/vector-db-data-store';

type MultiQueryResponse = Awaited<
  ReturnType<typeof Collection.prototype.query>
>;

export const createVectorStoreSearchResult = (
  result: MultiQueryResponse,
): IVectorStoreDocument[] => {
  const scores = result.distances
    ? convertCosineDistancesToScores(result.distances)
    : undefined;
  const metadatas = result.metadatas.flat().filter(Boolean);
  return result.documents.flat().map((document, idx) => ({
    id: result.ids.flat().at(idx)?.toString() ?? '',
    content: document ?? '',
    metadata: metadatas.at(idx) ?? {},
    score: scores?.at(idx),
  }));
};

/**
 * Converts a 2D array of cosine distances into a flattened array of similarity scores.
 * @param distances - A 2D array of cosine distances (e.g., [[1.04, 1.24], [0.8, 1.5]]).
 * @returns A flattened array of similarity scores (e.g., [0.48, 0.38, 0.6, 0.25]).
 */
function convertCosineDistancesToScores(distances: number[][]): number[] {
  return distances.flat().map((distance) => {
    // 1. Validate that the distance is within the valid range [0, 2].
    if (distance < 0 || distance > 2) {
      throw new Error(
        `Cosine distance must be between 0 and 2. Received: ${distance}`,
      );
    }

    // 2. Convert cosine distance (d) to similarity score (s): s = 1 - (d / 2).
    return 1 - distance / 2;
  });
}
