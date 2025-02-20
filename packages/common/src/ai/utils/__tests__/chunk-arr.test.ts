import { chunkArr } from '../chunk-arr.js';

describe('chunkArr', () => {
  it('should split array into chunks of specified size', () => {
    const array = [1, 2, 3, 4, 5, 6, 7];
    const result = chunkArr(array, 3);
    expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('should handle empty arrays', () => {
    const array: number[] = [];
    const result = chunkArr(array, 2);
    expect(result).toEqual([]);
  });

  it('should handle chunk size equal to array length', () => {
    const array = [1, 2, 3];
    const result = chunkArr(array, 3);
    expect(result).toEqual([[1, 2, 3]]);
  });

  it('should handle chunk size larger than array length', () => {
    const array = [1, 2];
    const result = chunkArr(array, 3);
    expect(result).toEqual([[1, 2]]);
  });

  it('should throw error for chunk size less than or equal to 0', () => {
    const array = [1, 2, 3];
    expect(() => chunkArr(array, 0)).toThrow(
      'Chunk size must be greater than 0',
    );
    expect(() => chunkArr(array, -1)).toThrow(
      'Chunk size must be greater than 0',
    );
  });

  it('should work with different types', () => {
    const array = ['a', 'b', 'c', 'd'];
    const result = chunkArr(array, 2);
    expect(result).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});
