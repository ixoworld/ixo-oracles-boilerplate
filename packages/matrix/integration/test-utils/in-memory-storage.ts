import { Logger } from '@ixo/logger';

export class InMemoryJsonStorage {
  private storage: Record<string, unknown> & {
    uint8arrays: Record<string, boolean>;
  } = {
    uint8arrays: {},
  };

  constructor() {
    console.log('InMemoryJsonStorage constructor');
    this.storage = this.createStorage();
  }

  /**
   * Get an item from the storage.
   * @param key - The key of the item to get.
   * @returns The item value.
   *
   * if the item is a Uint8Array, it will be deserialized and returned as a Uint8Array.
   *
   * @example
   * const storage = new InMemoryJsonStorage();
   * const item = storage.getItem('key');
   * console.log(item); // { ... }
   *
   * const uint8Array = storage.getItem('uint8arrayKey');
   * console.log(uint8Array); // Uint8Array(10) [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
   */
  getItem<T>(key: string): T {
    const value = this.storage[key];
    // check if item is a Uint8Array using the map
    if (this.storage.uint8arrays[key]) {
      const deserializedArray = Uint8Array.from(
        Object.values(value as Record<string, number>),
      );
      return deserializedArray as T;
    }
    return value as T;
  }

  /**
   * Set an item in the storage.
   * @param key - The key of the item to set.
   * @param value - The value of the item to set.
   *
   * @example
   * const storage = new InMemoryJsonStorage();
   * storage.setItem('key', { ... } );
   */
  setItem(key: string, value: unknown): void {
    try {
      this.storage[key] = value;

      // custom logic to save Uint8Array
      if (value instanceof Uint8Array) {
        this.storage.uint8arrays = {
          ...this.storage.uint8arrays,
          [key]: true,
        };
      }
    } catch (error) {
      Logger.error('Failed to set item', error);
      throw error;
    }
  }

  /**
   * Remove an item from the storage.
   * @param key - The key of the item to remove.
   */
  removeItem(key: string): void {
    try {
      delete this.storage[key];
      delete this.storage.uint8arrays[key];
    } catch (error) {
      Logger.error('Failed to remove item', error);
      throw error;
    }
  }

  /**
   * Clear all items from the storage.
   */
  clear(): void {
    try {
      this.storage = this.createStorage();
    } catch (error) {
      Logger.error('Failed to clear storage', error);
      throw error;
    }
  }

  /**
   * Get the length of the storage.
   * @returns The length of the storage.
   */
  get length(): number {
    return Object.keys(this.storage).length;
  }

  /**
   * Get the key at the given index.
   * @param index - The index of the key to get.
   * @returns The key at the given index.
   */
  key(index: number): string | null {
    return Object.keys(this.storage)[index] ?? null;
  }

  /**
   * Get a snapshot of the current storage state.
   * Useful for testing and debugging.
   * @returns A copy of the current storage state
   */
  getStorageSnapshot(): Record<string, unknown> {
    return { ...this.storage };
  }

  private createStorage(): Record<string, unknown> & {
    uint8arrays: Record<string, boolean>;
  } {
    return { uint8arrays: {} };
  }
}
