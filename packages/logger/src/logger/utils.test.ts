import { flattenArray, getEmoji } from './utils';

describe('flattenArray', () => {
  it('should flatten a nested array', () => {
    const input = [1, [2, [3, [4]], 5]];
    const expectedOutput = [1, 2, 3, 4, 5];
    expect(flattenArray(input)).toEqual(expectedOutput);
  });

  it('should return the same array if it is already flat', () => {
    const input = [1, 2, 3, 4, 5];
    const expectedOutput = [1, 2, 3, 4, 5];
    expect(flattenArray(input)).toEqual(expectedOutput);
  });

  it('should handle empty arrays', () => {
    const input: unknown[] = [];
    const expectedOutput: unknown[] = [];
    expect(flattenArray(input)).toEqual(expectedOutput);
  });

  it('should handle arrays with non-array elements', () => {
    const input = [1, 'string', { key: 'value' }, [2, 3]];
    const expectedOutput = [1, 'string', { key: 'value' }, 2, 3];
    expect(flattenArray(input)).toEqual(expectedOutput);
  });

  it('should handle non-array input', () => {
    const input = 1;
    const expectedOutput = [1];
    expect(flattenArray(input)).toEqual(expectedOutput);
  });

  it('should handle deeply nested arrays', () => {
    const input = [[[[1]]], 2, [[3, [4]], 5]];
    const expectedOutput = [1, 2, 3, 4, 5];
    expect(flattenArray(input)).toEqual(expectedOutput);
  });
});
describe('getEmoji', () => {
  it('should return the correct emoji for info level', () => {
    const level = 'info';
    const expectedOutput = 'ℹ️';
    expect(getEmoji(level)).toBe(expectedOutput);
  });

  it('should return the correct emoji for warn level', () => {
    const level = 'warn';
    const expectedOutput = '⚠️';
    expect(getEmoji(level)).toBe(expectedOutput);
  });

  it('should return the correct emoji for error level', () => {
    const level = 'error';
    const expectedOutput = '❌';
    expect(getEmoji(level)).toBe(expectedOutput);
  });

  it('should return an empty string for unknown levels', () => {
    const level = 'debug';
    const expectedOutput = '';
    expect(getEmoji(level)).toBe(expectedOutput);
  });

  it('should return an empty string for empty level', () => {
    const level = '';
    const expectedOutput = '';
    expect(getEmoji(level)).toBe(expectedOutput);
  });
});
