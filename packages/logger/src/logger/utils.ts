function getEmoji(level: string): string {
  switch (level) {
    case 'info':
      return 'ℹ️';
    case 'warn':
      return '⚠️';
    case 'error':
      return '❌';
    default:
      return '';
  }
}

const flattenArray = (arr: unknown): unknown[] => {
  if (!Array.isArray(arr)) {
    return [arr];
  }
  return arr.reduce<unknown[]>((acc, val) => {
    return Array.isArray(val) ? acc.concat(flattenArray(val)) : acc.concat(val);
  }, []);
};

export { flattenArray, getEmoji };
