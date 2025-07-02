# @ixo/data-store

## Overview

The `@ixo/data-store` package provides abstract interfaces and implementations for both vector and structured data storage in the ixo-oracles ecosystem. It offers a type-safe, consistent API for managing data across different storage backends.

### Key Features

- 🔍 Vector database abstraction with ChromaDB implementation
- 📊 Structured data storage with Airtable implementation
- 🔐 Type-safe interfaces for data operations
- 🎯 Flexible query capabilities
- 🔄 Batch operations support
- 🏗️ Extensible architecture for custom implementations

## Table of Contents

1. [Getting Started](#getting-started)
   - [Installation](#installation)
   - [Configuration](#configuration)
2. [Vector Database Storage](#vector-database-storage)
   - [Implementing Vector Storage](#implementing-vector-storage)
   - [Using ChromaDB Implementation](#using-chromadb-implementation)
3. [Structured Data Storage](#structured-data-storage)
   - [Implementing Structured Storage](#implementing-structured-storage)
   - [Using Airtable Implementation](#using-airtable-implementation)
4. [Development](#development)

## Getting Started

### Installation

```bash
# Install using pnpm (recommended)
pnpm install @ixo/data-store

# Or using npm
npm install @ixo/data-store

# Or using yarn
yarn add @ixo/data-store
```

### Configuration

#### For ChromaDB Vector Storage

```bash
OPENAI_API_KEY=your_openai_api_key    # Required for embeddings
```

#### Running Chroma Backend

The ChromaDB implementation requires a running Chroma backend. You can easily run it using Docker:

```bash
# Pull the Chroma image
docker pull chromadb/chroma

# Run the Chroma container
docker run -p 8000:8000 chromadb/chroma
```

This will start the Chroma backend server on `http://localhost:8000`.

#### For Airtable Structured Storage

```bash
AIRTABLE_API_KEY=your_airtable_key    # Required for Airtable operations
AIRTABLE_BASE_ID=your_base_id         # Required for Airtable operations
AITABLE_BASE_TABLE_LINK=your_link     # Optional, for record links
```

## Vector Database Storage

The vector database interface provides methods for storing, retrieving, and querying vector embeddings of documents.

### Implementing Vector Storage

To create a custom vector storage implementation, extend the `VectorDBDataStore` abstract class:

```typescript
import {
  VectorDBDataStore,
  IVectorStoreDocument,
  IVectorStoreOptions,
} from '@ixo/data-store';

class CustomVectorStore extends VectorDBDataStore {
  constructor(options: IVectorStoreOptions) {
    super(options);
  }

  async init(): Promise<void> {
    // Initialize your vector store
  }

  async upsert(documents: IVectorStoreDocument[]): Promise<void> {
    // Implement document upsertion
  }

  async delete(ids: string[]): Promise<void> {
    // Implement document deletion
  }

  async query(
    query: string,
    options?: IVectorStoreQueryOptions,
  ): Promise<IVectorStoreDocument[]> {
    // Implement text-based querying
  }

  async queryByVector(
    vector: number[],
    options?: IVectorStoreQueryOptions,
  ): Promise<IVectorStoreDocument[]> {
    // Implement vector-based querying
  }

  async getById(id: string): Promise<IVectorStoreDocument | null> {
    // Implement document retrieval by ID
  }

  async queryWithSimilarity(
    query: string,
    options?: IVectorStoreQueryOptions & { similarityThreshold: number },
  ): Promise<IVectorStoreDocument[]> {
    // Implement similarity-based querying
  }
}
```

### Using ChromaDB Implementation

The package includes a ChromaDB implementation:

```typescript
import { ChromaDataStore } from '@ixo/data-store';

const store = new ChromaDataStore({
  collectionName: 'my-collection',
  url: 'http://localhost:8000',
});

await store.init();

// Store documents
await store.upsert([
  {
    id: '1',
    content: 'Document content',
    metadata: { type: 'article' },
  },
]);

// Query documents
const results = await store.query('search query', {
  topK: 5,
  filters: { type: 'article' },
});

// Query with similarity threshold
const similarDocs = await store.queryWithSimilarity('query', {
  similarityThreshold: 0.8,
});
```

## Structured Data Storage

The structured data interface provides CRUD operations for structured data storage.

### Implementing Structured Storage

To create a custom structured storage implementation, implement the `IDataStore` interface:

```typescript
import { IDataStore } from '@ixo/data-store';

class CustomDataStore<T> implements IDataStore<T> {
  async getAllRecords(
    tableName: string,
    selectOptions: IQueryParams<T>,
  ): Promise<T[]> {
    // Implement fetching all records
  }

  async getRecord(tableName: string, recordId: string): Promise<T> {
    // Implement single record retrieval
  }

  async createRecord(tableName: string, recordData: T): Promise<T> {
    // Implement record creation
  }

  async updateRecord(
    tableName: string,
    recordId: string,
    recordData: T,
  ): Promise<T> {
    // Implement record update
  }

  async batchUpdateRecords(
    tableName: string,
    records: { id: string; fields: T }[],
  ): Promise<T[]> {
    // Implement batch update
  }

  async deleteRecord(tableName: string, recordId: string): Promise<T> {
    // Implement record deletion
  }

  async getRecordByField(
    tableName: string,
    fieldName: string,
    fieldValue: string,
  ): Promise<T[]> {
    // Implement field-based retrieval
  }
}
```

### Using Airtable Implementation

The package includes an Airtable implementation:

```typescript
import { AirtableDataStore, FieldSet } from '@ixo/data-store';

interface MyRecord extends FieldSet {
  name: string;
  description: string;
}

const store = new AirtableDataStore<MyRecord>();

// Create a record
const record = await store.createRecord('tableName', {
  name: 'Test',
  description: 'Description',
});

// Get all records
const records = await store.getAllRecords('tableName', {
  maxRecords: 100,
  view: 'Grid view',
});

// Update records in batch
const updated = await store.batchUpdateRecords('tableName', [
  { id: '1', fields: { name: 'Updated' } },
  { id: '2', fields: { name: 'Also Updated' } },
]);
```

## Development

### Testing

```bash
# Run tests
pnpm test

```

### Contributing

1. Implement the appropriate interface (`VectorDBDataStore` or `IDataStore`)
2. Add comprehensive tests
3. Document your implementation
4. Submit a pull request

## License

Internal package - All rights reserved.
