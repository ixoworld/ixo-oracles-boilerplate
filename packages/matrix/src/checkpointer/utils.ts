export function searchBackward<T>(
  arr: T[],
  fn: (element: T) => boolean,
): T | undefined {
  if (arr.length === 0) return undefined;

  for (let i = arr.length - 1; i >= 0; i--) {
    const element = arr[i];
    if (!element) {
      continue;
    }
    if (fn(element)) {
      return element;
    }
  }

  return undefined;
}
