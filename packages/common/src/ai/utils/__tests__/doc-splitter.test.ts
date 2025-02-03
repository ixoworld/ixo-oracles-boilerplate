import { Document } from '@langchain/core/documents';
import { docSplitter } from '../doc-splitter';

describe('docSplitter', () => {
  it('should split a single string into documents', async () => {
    const text = 'This is a test document';
    const result = await docSplitter(text);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBeInstanceOf(Document);
  });

  it('should split an array of strings into documents', async () => {
    const texts = ['First document', 'Second document'];
    const result = await docSplitter(texts);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(expect.arrayContaining([expect.any(Document)]));
  });

  it('should throw error for empty string', () => {
    expect(() => docSplitter('')).toThrow('No text provided');
  });

  it('should throw error for empty array', () => {
    expect(() => docSplitter([])).toThrow('Text array cannot be empty');
  });

  it('should throw error for null or undefined input', () => {
    // @ts-expect-error testing invalid input
    expect(() => docSplitter(null)).toThrow('No text provided');
    // @ts-expect-error testing invalid input
    expect(() => docSplitter(undefined)).toThrow('No text provided');
  });

  it('should handle long text correctly', async () => {
    const longText = 'a'.repeat(2000);
    const result = await docSplitter(longText);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
