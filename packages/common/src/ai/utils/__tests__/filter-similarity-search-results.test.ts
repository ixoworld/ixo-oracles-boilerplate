import { Document } from '@langchain/core/documents';
import { filterSimilaritySearchResults } from '../filter-similarity-search-results';

describe('filterSimilaritySearchResults', () => {
  const createDoc = (content: string): Document =>
    new Document({ pageContent: content });

  it('should filter results above threshold', () => {
    const results = [
      [createDoc('doc1'), 0.9],
      [createDoc('doc2'), 0.7],
      [createDoc('doc3'), 0.3],
    ] as [Document, number][];

    const filtered = filterSimilaritySearchResults(results, 0.5);
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toBeInstanceOf(Document);
    expect(filtered[1]).toBeInstanceOf(Document);
  });

  it('should return empty array when no results meet threshold', () => {
    const results = [
      [createDoc('doc1'), 0.3],
      [createDoc('doc2'), 0.2],
    ] as [Document, number][];

    const filtered = filterSimilaritySearchResults(results, 0.5);
    expect(filtered).toHaveLength(0);
  });

  it('should handle empty results array', () => {
    const results: [Document, number][] = [];
    const filtered = filterSimilaritySearchResults(results, 0.5);
    expect(filtered).toHaveLength(0);
  });

  it('should handle threshold of 0', () => {
    const results = [
      [createDoc('doc1'), 0.1],
      [createDoc('doc2'), 0.2],
    ] as [Document, number][];

    const filtered = filterSimilaritySearchResults(results, 0);
    expect(filtered).toHaveLength(2);
  });

  it('should handle threshold of 1', () => {
    const results = [
      [createDoc('doc1'), 0.9],
      [createDoc('doc2'), 1.0],
    ] as [Document, number][];

    const filtered = filterSimilaritySearchResults(results, 1);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBeInstanceOf(Document);
  });
});
