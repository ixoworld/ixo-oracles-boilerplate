export function throttle<T extends (...args: any[]) => void>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  if (typeof func !== 'function') {
    throw new TypeError(
      `Expected the first argument to be a \`function\`, got \`${typeof func}\`.`,
    );
  }

  // TODO: Add `wait` validation too in the next major version.

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastCallTime = 0;

  return function throttled(this: unknown, ...args: Parameters<T>) {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    const delayForNextCall = wait - timeSinceLastCall;

    if (delayForNextCall <= 0) {
      lastCallTime = now;
      func.apply(this, args);
    } else {
      timeoutId = setTimeout(() => {
        lastCallTime = Date.now();
        func.apply(this, args);
      }, delayForNextCall);
    }
  };
}

export function asyncThrottle<T extends (...args: any[]) => Promise<any>>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  if (typeof func !== 'function') {
    throw new TypeError(
      `Expected the first argument to be a \`function\`, got \`${typeof func}\`.`,
    );
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastCallTime = 0;
  let pendingPromise: Promise<Awaited<ReturnType<T>>> | null = null;

  return function throttled(
    this: unknown,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;
    const delayForNextCall = wait - timeSinceLastCall;

    if (delayForNextCall <= 0) {
      // Execute immediately
      lastCallTime = now;
      return func.apply(this, args);
    }
    // If there's already a pending promise, return it
    if (pendingPromise) {
      return pendingPromise;
    }

    // Create new promise for delayed execution
    pendingPromise = new Promise((resolve, reject) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(async () => {
        try {
          lastCallTime = Date.now();
          const result = await func.apply(this, args);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          pendingPromise = null;
        }
      }, delayForNextCall);
    });

    return pendingPromise;
  };
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  if (typeof func !== 'function') {
    throw new TypeError(
      `Expected the first argument to be a \`function\`, got \`${typeof func}\`.`,
    );
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return function debounced(this: unknown, ...args: Parameters<T>) {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

export function asyncDebounce<T extends (...args: any[]) => Promise<any>>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  if (typeof func !== 'function') {
    throw new TypeError(
      `Expected the first argument to be a \`function\`, got \`${typeof func}\`.`,
    );
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let pendingPromise: Promise<Awaited<ReturnType<T>>> | null = null;

  return function debounced(
    this: unknown,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> {
    // If there's already a pending promise, return it
    if (pendingPromise) {
      return pendingPromise;
    }

    // Create new promise for delayed execution
    pendingPromise = new Promise((resolve, reject) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(async () => {
        try {
          const result = await func.apply(this, args);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          pendingPromise = null;
        }
      }, wait);
    });

    return pendingPromise;
  };
}
