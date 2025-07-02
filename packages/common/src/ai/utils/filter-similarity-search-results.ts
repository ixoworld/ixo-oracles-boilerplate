import { type Document } from '@langchain/core/documents';

function filterSimilaritySearchResults<
  Doc extends Document,
  Result extends [Doc, number][],
>(results: Result, threshold: number): Doc[] {
  const filteredResults = [];
  for (const [doc, score] of results) {
    if (score >= threshold) {
      filteredResults.push(doc);
    }
  }
  return filteredResults;
}
export { filterSimilaritySearchResults };
