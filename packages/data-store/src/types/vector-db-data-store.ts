import { type IEmbeddingFunction, type Metadata } from 'chromadb';

/**
 * Represents a document in the vector store.
 */
export interface IVectorStoreDocument {
  /**
   * Unique identifier for the document.
   */
  id: string;

  /**
   * The content or data of the document.
   */
  content: string;

  /**
   * Optional metadata associated with the document.
   */
  metadata?: Metadata;

  /**
   * The score of the document.
   */
  score?: number;
}
/**
 * Options for querying the vector store.
 */
export interface IVectorStoreQueryOptions<
  Filters extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * The number of top results to return.
   */
  topK?: number;

  /**
   * Filters to apply based on document metadata.
   */
  filters?: Filters;
}

export interface IVectorStoreOptions {
  collectionName: string;
  url: string;
  embeddingFunction?: IEmbeddingFunction;
}

export abstract class VectorDBDataStore {
  constructor(protected readonly options: IVectorStoreOptions) {}

  abstract upsert(documents: IVectorStoreDocument[]): Promise<void>;
  abstract delete(ids: string[]): Promise<void>;
  abstract queryByVector(
    vector: number[],
    options?: IVectorStoreQueryOptions,
  ): Promise<IVectorStoreDocument[]>;
  abstract query(
    query: string,
    options?: IVectorStoreQueryOptions,
  ): Promise<IVectorStoreDocument[]>;
  abstract getById(id: string): Promise<IVectorStoreDocument | null>;
  abstract queryWithSimilarity(
    query: string,
    options?: IVectorStoreQueryOptions & { similarityThreshold: number },
  ): Promise<IVectorStoreDocument[]>;

  abstract init(): Promise<void>;
}
