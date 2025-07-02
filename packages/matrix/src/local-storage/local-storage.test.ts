import fs from 'node:fs';
import { LocalJsonStorage } from './local-storage';

jest.mock('node:fs');
jest.mock('@ixo/logger');

describe('LocalJsonStorage', () => {
  const mockLocation = 'test-storage.json';
  let storage: LocalJsonStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fs.existsSync to return false initially (no directories/files exist)
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    storage = new LocalJsonStorage(mockLocation);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create necessary directories if they do not exist', () => {
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('matrix-local-storage'),
        { recursive: true },
      );
    });

    it('should load existing data if file exists', () => {
      const mockData = {
        testKey: 'testValue',
        uint8arrays: {},
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const mockReadFileSync = jest
        .fn()
        .mockReturnValue(JSON.stringify(mockData));

      jest.spyOn(fs, 'readFileSync').mockImplementation(mockReadFileSync);

      const newStorage = new LocalJsonStorage(mockLocation);
      expect(mockReadFileSync).toHaveBeenCalled();
      expect(newStorage.getItem('testKey')).toBe('testValue');
    });

    it('should create empty storage if file exists but is corrupted', () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid-json');

      const newStorage = new LocalJsonStorage(mockLocation);
      expect(newStorage.length).toBe(1); // only uint8arrays object
    });
  });

  describe('getItem', () => {
    it('should return stored value', () => {
      const testValue = { test: 'value' };
      storage.setItem('testKey', testValue);
      expect(storage.getItem('testKey')).toEqual(testValue);
    });

    it('should properly handle Uint8Array values', () => {
      const testArray = new Uint8Array([1, 2, 3, 4]);
      storage.setItem('arrayKey', testArray);
      const retrieved = storage.getItem('arrayKey');
      expect(retrieved).toBeInstanceOf(Uint8Array);
      expect(Array.from(retrieved as Uint8Array)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('setItem', () => {
    it('should store and persist values', () => {
      const testValue = { test: 'value' };
      storage.setItem('testKey', testValue);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
      );
      expect(storage.getItem('testKey')).toEqual(testValue);
    });

    it('should handle Uint8Array values', () => {
      const testArray = new Uint8Array([1, 2, 3, 4]);
      storage.setItem('arrayKey', testArray);
      expect(storage.getItem('arrayKey')).toBeInstanceOf(Uint8Array);
    });

    it('should throw error if write fails', () => {
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Write failed');
      });
      expect(() => {
        storage.setItem('key', 'value');
      }).toThrow();
    });
  });

  describe('removeItem', () => {
    it('should remove item and persist changes', () => {
      storage.setItem('testKey', 'value');
      storage.removeItem('testKey');
      expect(storage.getItem('testKey')).toBeUndefined();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should remove Uint8Array flag when removing Uint8Array item', () => {
      const testArray = new Uint8Array([1, 2, 3]);
      storage.setItem('arrayKey', testArray);
      storage.removeItem('arrayKey');
      expect(storage.getItem('arrayKey')).toBeUndefined();
      expect(
        storage.getItem<Record<string, boolean>>('uint8arrays').arrayKey,
      ).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all items and persist empty storage', () => {
      storage.setItem('key1', 'value1');
      storage.setItem('key2', 'value2');
      storage.clear();
      expect(storage.length).toBe(1); // only uint8arrays object remains
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('length', () => {
    it('should return correct number of items', () => {
      expect(storage.length).toBe(1); // initial uint8arrays object
      storage.setItem('key1', 'value1');
      storage.setItem('key2', 'value2');
      expect(storage.length).toBe(3); // including uint8arrays object
    });
  });

  describe('key', () => {
    it('should return key at given index', () => {
      storage.setItem('key1', 'value1');
      storage.setItem('key2', 'value2');
      expect(storage.key(1)).toBe('key1');
    });

    it('should return null for invalid index', () => {
      expect(storage.key(999)).toBeNull();
    });
  });
});
