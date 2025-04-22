import {
  ChromaClient,
  type Collection,
  type Metadata,
  type QueryRecordsParams,
} from 'chromadb';
import {
  VectorDBDataStore,
  type IVectorStoreDocument,
  type IVectorStoreOptions,
  type IVectorStoreQueryOptions,
} from '../types/vector-db-data-store';
import { type IChromaMetadataFilter } from './chroma.types';
import { OpenAIEmbeddingFunction } from './embedding-function';
import { createVectorStoreSearchResult } from './utils';

/**
 * ChromaDataStore class for managing vector storage and retrieval using ChromaDB
 */
class ChromaDataStore extends VectorDBDataStore {
  private readonly client: ChromaClient;
  private collection: Collection;

  /**
   * Creates a new ChromaDataStore instance
   * @param options - Configuration options for the vector store
   * @throws Error if OPENAI_API_KEY is not set and no embedding function is provided
   */
  constructor(options: IVectorStoreOptions) {
    if (
      typeof process.env.OPENAI_API_KEY !== 'string' &&
      !options.embeddingFunction
    ) {
      throw new Error(
        'OPENAI_API_KEY is not set and no embedding function is provided',
      );
    }
    options.embeddingFunction =
      options.embeddingFunction ||
      new OpenAIEmbeddingFunction({
        openai_api_key: process.env.OPENAI_API_KEY ?? '',
        openai_model: 'text-embedding-3-small',
      });
    options.url = options.url || 'http://localhost:8000';
    options.collectionName = options.collectionName || 'default-vector-store';
    super(options);
    this.client = new ChromaClient({
      path: options.url,
    });

    // this is a workaround to avoid setting collection as optional
    this.collection = undefined as unknown as Collection;
  }

  /**
   * Checks if the ChromaDB collection is initialized
   * @throws Error if collection is not initialized
   */
  private checkIsInitialized(): void {
    if (!this.collection as unknown) {
      throw new Error('ChromaDataStore is not initialized');
    }
  }

  /**
   * Initializes the ChromaDB collection
   */
  async init(): Promise<void> {
    if (this.collection as unknown) {
      return;
    }
    const collection = await this.client.getOrCreateCollection({
      name: this.options.collectionName,
      embeddingFunction: this.options.embeddingFunction,
    });
    this.collection = collection;
  }

  /**
   * Queries the vector store using text
   * @param query - Text query to search for
   * @param options - Query options including filters and top-k results
   * @returns Array of matching documents
   */
  async query(
    query: string,
    options?: IVectorStoreQueryOptions<IChromaMetadataFilter>,
  ): Promise<IVectorStoreDocument[]> {
    this.checkIsInitialized();
    const params: QueryRecordsParams = {
      queryTexts: [query],
      nResults: options?.topK || 10,
    };
    if (options?.filters) {
      params.where = options.filters;
    }
    const result = await this.collection.query(params);
    return createVectorStoreSearchResult(result);
  }

  /**
   * Queries the vector store and filters results by similarity threshold
   * @param query - Text query to search for
   * @param options - Query options including similarity threshold
   * @returns Array of documents meeting the similarity threshold
   */
  async queryWithSimilarity(
    query: string,
    options?: IVectorStoreQueryOptions<IChromaMetadataFilter> & {
      similarityThreshold: number;
    },
  ): Promise<IVectorStoreDocument[]> {
    this.checkIsInitialized();
    const result = await this.query(query, options);
    return result.filter(
      (doc) =>
        (doc.score && doc.score >= (options?.similarityThreshold ?? 0.5)) ??
        false,
    );
  }

  /**
   * Upserts (inserts or updates) documents into the vector store
   * @param documents - Array of documents to upsert
   * @throws Error if any document is missing an ID
   */
  async upsert(documents: IVectorStoreDocument[]): Promise<void> {
    this.checkIsInitialized();
    const [ids, contents, metadatas]: [string[], string[], Metadata[]] =
      documents.reduce<[string[], string[], Metadata[]]>(
        (acc, doc) => {
          const id = doc.id;
          const metadata = doc.metadata ?? {};
          const content = doc.content;
          if (!id) {
            throw new Error('Document ID is required');
          }
          acc[0].push(id);
          acc[1].push(content);
          acc[2].push(metadata);
          return acc;
        },
        [[], [], []],
      );

    await this.collection.upsert({
      ids,
      documents: contents,
      metadatas,
    });
  }

  /**
   * Deletes documents from the vector store by their IDs
   * @param ids - Array of document IDs to delete
   */
  async delete(ids: string[]): Promise<void> {
    this.checkIsInitialized();
    await this.collection.delete({
      ids,
    });
  }

  /**
   * Retrieves a document by its ID
   * @param id - Document ID to retrieve
   * @returns The document if found, null otherwise
   */
  async getById(id: string): Promise<IVectorStoreDocument | null> {
    const result = await this.collection.get({
      ids: [id],
    });
    return result.documents.at(0)
      ? {
          id: result.ids.at(0)?.toString() ?? '',
          content: result.documents.at(0) ?? '',
          metadata: result.metadatas.at(0) ?? {},
          score: undefined,
        }
      : null;
  }

  /**
   * Queries the vector store using a pre-computed embedding vector
   * @param vector - The embedding vector to search with
   * @param options - Query options including top-k results
   * @returns Array of matching documents
   */
  async queryByVector(
    vector: number[],
    options?: IVectorStoreQueryOptions,
  ): Promise<IVectorStoreDocument[]> {
    this.checkIsInitialized();
    const result = await this.collection.query({
      queryEmbeddings: [vector],
      nResults: options?.topK || 10,
    });
    return createVectorStoreSearchResult(result);
  }

  /**
   * Updates the metadata for a document by its ID
   * @param ids - Array of document IDs to update
   * @param metadata - Metadata to update
   */
  async updateMetadata(ids: string[], metadatas: Metadata[]): Promise<void> {
    this.checkIsInitialized();
    await this.collection.update({
      ids,
      metadatas,
    });
  }
}

export { ChromaDataStore };
