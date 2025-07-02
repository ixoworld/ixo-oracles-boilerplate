/* eslint-disable jest/unbound-method  -- ignore this for now */
import { ChromaClient, Collection, type IEmbeddingFunction } from 'chromadb';
import { ChromaDataStore } from './chroma-data-store';

jest.mock('chromadb');
const embeddingFunction: IEmbeddingFunction = {
  generate: jest.fn(),
};
jest
  .mocked(ChromaClient.prototype.getOrCreateCollection)
  .mockResolvedValue(
    new Collection(
      'test',
      'test',
      jest.fn() as unknown as ChromaClient,
      embeddingFunction,
    ),
  );

describe('ChromaDataStore', () => {
  beforeAll(() => {
    process.env.OPENAI_API_KEY = 'test';
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = undefined;
  });

  it('should be defined', () => {
    expect(ChromaDataStore).toBeDefined();
  });

  describe('Initialization', () => {
    it('should construct and initialize without errors', async () => {
      // Should not throw during construction
      const chromaDataStore = new ChromaDataStore({
        collectionName: 'test',
        url: 'http://localhost:8000',
      });
      expect(chromaDataStore).toBeInstanceOf(ChromaDataStore);

      // Should not throw during initialization
      await expect(chromaDataStore.init()).resolves.not.toThrow();
    });

    it('should throw error when OPENAI_API_KEY is not set and no embedding function is provided', () => {
      // Temporarily remove API key
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      // Should throw during construction
      expect(
        () =>
          new ChromaDataStore({
            collectionName: 'test',
            url: 'http://localhost:8000',
          }),
      ).toThrow('OPENAI_API_KEY is not set');

      // Restore API key
      process.env.OPENAI_API_KEY = originalKey;
    });

    it('should create collection or use existing collection', async () => {
      jest.spyOn(ChromaClient.prototype, 'getOrCreateCollection');
      const chromaDataStore = new ChromaDataStore({
        collectionName: 'test',
        url: 'http://localhost:8000',
        embeddingFunction,
      });
      await chromaDataStore.init();
      expect(ChromaClient.prototype.getOrCreateCollection).toHaveBeenCalledWith(
        {
          name: 'test',
          embeddingFunction,
        },
      );
    });
  });

  describe('Query', () => {
    let chromaDataStore: ChromaDataStore;
    beforeAll(async () => {
      chromaDataStore = new ChromaDataStore({
        collectionName: 'test',
        url: 'http://localhost:8000',
        embeddingFunction,
      });
      await chromaDataStore.init();

      await chromaDataStore.init();
      jest.mocked(Collection.prototype.query).mockResolvedValue({
        ids: [['1', '2']],
        embeddings: null,
        documents: [['Hello, world!', 'Hello, world! 2']],
        metadatas: [[{ title: 'Hello, world!' }, { title: 'Hello, world! 2' }]],
        distances: [[3.3435163194430493e-16, 0.30934086831133445]],
        included: [],
      });
    });

    it('should query documents', async () => {
      const documents = await chromaDataStore.query('Hello, world!');
      expect(documents).toHaveLength(2);
      expect(documents[0]?.id).toBe('1');
      expect(documents[0]?.content).toBe('Hello, world!');
    });

    it('should query documents by vector', async () => {
      const vector = [1, 2, 3];
      const documents = await chromaDataStore.queryByVector(vector);
      expect(documents).toHaveLength(2);
      expect(documents[0]?.id).toBe('1');
      expect(documents[0]?.content).toBe('Hello, world!');
    });

    it('should query documents by similarity', async () => {
      const documents = await chromaDataStore.queryWithSimilarity(
        'Hello, world!',
        { similarityThreshold: 0.9 },
      );
      expect(documents).toHaveLength(1);
      expect(documents[0]?.id).toBe('1');
      expect(documents[0]?.content).toBe('Hello, world!');
    });

    it('should get document by id', async () => {
      jest.spyOn(Collection.prototype, 'get');
      jest.mocked(Collection.prototype.get).mockResolvedValue({
        ids: ['1'],
        embeddings: null,
        documents: ['Hello, world!'],
        metadatas: [{ title: 'Hello, world!' }],
        included: [],
      });
      const document = await chromaDataStore.getById('1');
      expect(Collection.prototype.get).toHaveBeenCalledWith({
        ids: ['1'],
      });
      expect(document?.id).toBe('1');
      expect(document?.content).toBe('Hello, world!');
    });

    it('should handle empty results', async () => {
      jest.mocked(Collection.prototype.query).mockResolvedValue({
        ids: [],
        embeddings: null,
        documents: [],
        metadatas: [],
        distances: [],
        included: [],
      });
      const documents = await chromaDataStore.query('Hello, world!');
      expect(documents).toHaveLength(0);
    });
  });

  describe('Upsert', () => {
    let chromaDataStore: ChromaDataStore;
    beforeAll(async () => {
      chromaDataStore = new ChromaDataStore({
        collectionName: 'test',
        url: 'http://localhost:8000',
        embeddingFunction,
      });
      await chromaDataStore.init();
    });

    it('should upsert documents', async () => {
      jest.spyOn(Collection.prototype, 'upsert');
      await chromaDataStore.upsert([
        {
          id: '1',
          content: 'Hello, world!',
          metadata: { title: 'Hello, world!' },
        },
        {
          id: '2',
          content: 'Hello, world! 2',
          metadata: { title: 'Hello, world! 2' },
        },
      ]);
      expect(Collection.prototype.upsert).toHaveBeenCalledWith({
        ids: ['1', '2'],
        documents: ['Hello, world!', 'Hello, world! 2'],
        metadatas: [{ title: 'Hello, world!' }, { title: 'Hello, world! 2' }],
      });
    });
  });

  describe('Delete', () => {
    let chromaDataStore: ChromaDataStore;
    beforeAll(async () => {
      chromaDataStore = new ChromaDataStore({
        collectionName: 'test',
        url: 'http://localhost:8000',
        embeddingFunction,
      });
      await chromaDataStore.init();
    });

    it('should delete documents', async () => {
      jest.spyOn(Collection.prototype, 'delete');
      await chromaDataStore.delete(['1', '2']);
      expect(Collection.prototype.delete).toHaveBeenCalledWith({
        ids: ['1', '2'],
      });
    });
  });
});
