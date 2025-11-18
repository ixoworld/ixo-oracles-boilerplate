import type { Item } from "@langchain/langgraph-checkpoint";

/**
 * SurrealDB connection configuration
 */
export interface SurrealDBConnectionConfig {
  /**
   * Connection URL or endpoint (e.g., "ws://localhost:8000", "http://localhost:8000")
   */
  url: string;

  /**
   * Namespace to use
   */
  namespace?: string;

  /**
   * Database to use
   */
  database?: string;

  /**
   * Authentication credentials
   */
  auth?: {
    username?: string;
    password?: string;
    token?: string;
  };
}

/**
 * Interface for embedding models.
 * Compatible with LangChain's Embeddings interface.
 */
export interface Embeddings {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export type EmbeddingsFunc = (texts: string[]) => Promise<number[][]>;
// SurrealDB supports MTREE and HNSW vector index types
// HNSW is generally preferred for better performance
export type VectorIndexType = "mtree" | "hnsw";
export type DistanceMetric = "cosine" | "l2" | "inner_product";

export interface HNSWConfig {
  /**
   * Maximum number of connections for each node in the graph.
   * Higher values improve recall but increase memory usage and build time.
   * @default 16
   */
  m?: number;

  /**
   * Size of the dynamic candidate list during construction.
   * Higher values improve index quality but increase build time.
   * @default 200
   */
  efConstruction?: number;

  /**
   * Size of the dynamic candidate list during search.
   * Higher values improve recall but increase search time.
   * Can be adjusted per query for performance tuning.
   * @default 40
   */
  ef?: number;
}

export interface MTreeConfig {
  /**
   * Configuration options for MTREE index.
   * MTREE is a tree-based index structure for metric spaces.
   * Note: SurrealDB-specific parameters may be added here as needed.
   */
  // Currently no specific config options documented for MTREE in SurrealDB
  // This interface is kept for future extensibility
}

export interface IndexConfig {
  /**
   * Number of dimensions in the embedding vectors.
   */
  dims: number;

  /**
   * Embedding function to generate embeddings from text.
   * Can be a LangChain Embeddings instance or a function.
   */
  embed: Embeddings | EmbeddingsFunc;

  /**
   * Fields to extract text from for embedding generation.
   * Uses JSON path syntax. Defaults to ["$"] (entire document).
   */
  fields?: string[];

  /**
   * Vector index type to use in SurrealDB.
   * - 'hnsw': Hierarchical Navigable Small World (best for most use cases, faster queries)
   * - 'mtree': M-Tree index (classic tree-based structure, good for exact searches)
   * @default 'hnsw'
   */
  indexType?: VectorIndexType;

  /**
   * Distance metric for vector similarity.
   * - 'cosine': Cosine similarity (normalized dot product)
   * - 'l2': Euclidean distance (L2 norm)
   * - 'inner_product': Dot product (note: may use cosine in SurrealDB)
   * @default 'cosine'
   */
  distanceMetric?: DistanceMetric;

  /**
   * HNSW-specific configuration parameters.
   * Only used when indexType is 'hnsw'.
   */
  hnsw?: HNSWConfig;

  /**
   * MTREE-specific configuration parameters.
   * Only used when indexType is 'mtree'.
   */
  mtree?: MTreeConfig;

  /**
   * Whether to create indexes for all distance metrics.
   * If false, only creates index for the specified distanceMetric.
   * @default false
   */
  createAllMetricIndexes?: boolean;
}

export interface TTLConfig {
  /**
   * Default TTL in minutes for new items.
   */
  defaultTtl?: number;

  /**
   * Whether to refresh TTL on read operations by default.
   * @default true
   */
  refreshOnRead?: boolean;

  /**
   * Interval in minutes between TTL sweep operations.
   * @default 60
   */
  sweepIntervalMinutes?: number;
}

export interface FilterOperators {
  $eq?: string | number | boolean | null;
  $ne?: string | number | boolean | null;
  $gt?: string | number;
  $gte?: string | number;
  $lt?: string | number;
  $lte?: string | number;
  $in?: (string | number | boolean | null)[];
  $nin?: (string | number | boolean | null)[];
  $exists?: boolean;
}

export interface SearchItem extends Item {
  /**
   * Relevance/similarity score for the search result.
   */
  score?: number;
}

export interface SearchOptions {
  /**
   * Filter conditions with support for advanced operators.
   */
  filter?: Record<string, string | number | boolean | null | FilterOperators>;

  /**
   * Natural language search query.
   */
  query?: string;

  /**
   * Maximum number of results to return.
   * @default 10
   */
  limit?: number;

  /**
   * Number of results to skip for pagination.
   * @default 0
   */
  offset?: number;

  /**
   * Whether to refresh TTL for returned items.
   */
  refreshTtl?: boolean;
}

export interface PutOptions {
  /**
   * TTL in minutes for this item.
   */
  ttl?: number;
}

export interface PostgresStoreConfig {
  /**
   * PostgreSQL connection string or connection configuration object.
   *
   * @example
   * // Connection string
   * "postgresql://user:password@localhost:5432/database"
   *
   * // Configuration object
   * {
   *   host: "localhost",
   *   port: 5432,
   *   database: "mydb",
   *   user: "postgres",
   *   password: "password"
   * }
   */
  connectionOptions: SurrealDBConnectionConfig;

  /**
   * Database schema name to use for store tables.
   * @default "public"
   */
  schema?: string;

  /**
   * Whether to automatically create tables if they don't exist.
   * @default true
   */
  ensureTables?: boolean;

  /**
   * TTL configuration for automatic expiration of items.
   */
  ttl?: TTLConfig;

  /**
   * Vector search configuration for semantic search capabilities.
   * If provided, enables vector similarity search using pgvector extension.
   */
  index?: IndexConfig;

  /**
   * Language for PostgreSQL full-text search operations.
   * Supports any language configuration available in PostgreSQL.
   * @default "english"
   */
  textSearchLanguage?: string;
}
