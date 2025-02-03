import { Document } from '@langchain/core/documents';
import { stringifyDocs } from '../stringify-docs';

describe('stringifyDocs', () => {
  it('should stringify a single document', () => {
    const doc = new Document({
      pageContent: 'Test content',
      metadata: { id: '123' },
    });
    const result = stringifyDocs([doc]);
    expect(result).toBe('#ID:123\n Document: Test content \n \n ');
  });

  it('should stringify multiple documents', () => {
    const docs = [
      new Document({
        pageContent: 'First content',
        metadata: { id: '1' },
      }),
      new Document({
        pageContent: 'Second content',
        metadata: { id: '2' },
      }),
    ];
    const expected =
      '#ID:1\n Document: First content \n \n \n\n#ID:2\n Document: Second content \n \n ';
    expect(stringifyDocs(docs)).toBe(expected);
  });

  it('should handle empty array', () => {
    expect(stringifyDocs([])).toBe('');
  });

  it('should handle documents with special characters', () => {
    const doc = new Document({
      pageContent: 'Content with \n newline and \t tab',
      metadata: { id: 'special' },
    });
    const expected =
      '#ID:special\n Document: Content with \n newline and \t tab \n \n ';
    expect(stringifyDocs([doc])).toBe(expected);
  });

  it('should handle documents with empty content', () => {
    const doc = new Document({
      pageContent: '',
      metadata: { id: 'empty' },
    });
    const expected = '#ID:empty\n Document:  \n \n ';
    expect(stringifyDocs([doc])).toBe(expected);
  });

  it('should handle documents with missing id in metadata', () => {
    const doc = new Document({
      pageContent: 'Test content',
      metadata: {},
    });
    const expected = '#ID:undefined\n Document: Test content \n \n ';
    expect(stringifyDocs([doc])).toBe(expected);
  });
});
