import { Logger } from '@ixo/logger';
import fs from 'node:fs';
import path from 'node:path';

export class LocalJsonStorage {
  private storage: Record<string, unknown> & {
    uint8arrays: Record<string, boolean>;
  } = {
    uint8arrays: {},
  };
  private location: string;

  constructor(location: string) {
    // Create matrix-local-storage as parent folder
    const matrixStorageDir = path.join(process.cwd(), 'matrix-local-storage');
    if (!fs.existsSync(matrixStorageDir)) {
      fs.mkdirSync(matrixStorageDir, { recursive: true });
    }

    // Put the location file inside matrix-local-storage folder
    this.location = path.join(matrixStorageDir, location);

    // Ensure any subdirectories in the location path exist
    const dir = path.dirname(this.location);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing data if file exists
    if (fs.existsSync(this.location)) {
      try {
        const data = fs.readFileSync(this.location, 'utf8');
        this.storage = JSON.parse(data) as Record<string, unknown> & {
          uint8arrays: Record<string, boolean>;
        };
      } catch (error) {
        Logger.error(
          'Failed to load existing data from file ',
          this.location,
          error,
        );

        Logger.error('Creating empty storage');

        this.storage = this.createStorage();
      }
    }
  }

  /**
   * Get an item from the storage.
   * @param key - The key of the item to get.
   * @returns The item value.
   *
   * if the item is a Uint8Array, it will be deserialized and returned as a Uint8Array.
   *
   * @example
   * const storage = new LocalJsonStorage('path/to/storage.json');
   * const item = storage.getItem('key');
   * console.log(item); // \{ ... \}
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
   * const storage = new LocalJsonStorage('path/to/storage.json');
   * storage.setItem('key', \{ ... \} );
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

      fs.writeFileSync(this.location, JSON.stringify(this.storage));
    } catch (error) {
      Logger.error('Failed to set item', error);
      throw error;
    }
  }

  removeItem(key: string): void {
    try {
      delete this.storage[key];
      delete this.storage.uint8arrays[key];
      fs.writeFileSync(this.location, JSON.stringify(this.storage));
    } catch (error) {
      Logger.error('Failed to remove item', error);
      throw error;
    }
  }

  clear(): void {
    try {
      this.storage = this.createStorage();
      fs.writeFileSync(this.location, JSON.stringify(this.storage));
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

  private createStorage(): Record<string, unknown> & {
    uint8arrays: Record<string, boolean>;
  } {
    return { uint8arrays: {} };
  }
}
export default LocalJsonStorage;
