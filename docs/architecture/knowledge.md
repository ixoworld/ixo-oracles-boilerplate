# Knowledge Management Architecture

## 📖 Overview

The knowledge management system in the IXO Oracles Framework provides AI oracles with access to structured and unstructured data sources. This system enables oracles to have context-aware conversations by leveraging stored knowledge, documents, and semantic search capabilities.

## 🏗️ Architecture Components

### 1. Data Store Layer (`@ixo/data-store`)

The data store package provides the foundation for knowledge management:

- **Vector Database Integration**: ChromaDB for semantic search and similarity matching
- **Structured Data Storage**: PostgreSQL for knowledge metadata and content storage
- **Hybrid Search**: Combines vector similarity with structured database queries
- **Document Processing**: Automatic chunking and embedding generation

### 2. Knowledge Entities

Knowledge is stored as structured entities with:

- **Content**: The actual knowledge content (text, documents, etc.)
- **Metadata**: Title, links, questions, status, and creation dates
- **Chunks**: Automatically split content into searchable chunks
- **Embeddings**: Vector representations for semantic search (stored in ChromaDB)
- **Status Management**: Pending review → Approved workflow

### 3. AI Integration

The knowledge system integrates with AI models through:

- **Semantic Search**: Find relevant knowledge based on user queries
- **Automatic Question Generation**: Creates FAQs from content chunks
- **Context Injection**: Automatically include relevant knowledge in AI prompts
- **Dynamic Retrieval**: Real-time knowledge lookup during conversations

## 🔧 Setup and Configuration

### Prerequisites

- **ChromaDB**: Vector database for embeddings and similarity search
- **PostgreSQL**: Primary data storage for knowledge entities
- **OpenAI API**: For generating embeddings and questions

### Environment Variables

```bash
# OpenAI Configuration (Required)
OPENAI_API_KEY=your_openai_api_key

# ChromaDB Configuration
CHROMA_HOST=localhost
CHROMA_PORT=8000

# PostgreSQL Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/oracles
```

### Database Migrations

Knowledge tables are automatically created through migrations:

```bash
# Run migrations
cd apps/app
pnpm run migrate
```

## 📚 Usage Patterns

### 1. Adding Knowledge

```typescript
import { KnowledgeService } from './knowledge.service';

// Add knowledge content
const result = await knowledgeService.createKnowledge({
  title: 'IXO Impact Verification',
  content: 'IXO is a blockchain-based impact verification platform...',
  links: 'https://ixo.world',
  questions: 'What is impact verification?',
});

// Returns: { id: string, numberOfChunks: number }
```

**What happens automatically:**

- Content is chunked into smaller pieces
- Each chunk gets a unique ID (e.g., `uuid/1`, `uuid/2`)
- OpenAI generates embeddings for each chunk
- Questions are automatically generated from content
- Content is stored in PostgreSQL
- Chunks + embeddings are stored in ChromaDB

### 2. Semantic Search

```typescript
// Search for relevant knowledge
const results = await knowledgeService.semanticSearch({
  query: 'How does IXO verify impact claims?',
});

// Returns: IVectorStoreDocument[] with similarity scores
```

**Search process:**

- Query is converted to embedding
- ChromaDB finds similar chunks using vector similarity
- Results are sorted by similarity score
- Metadata includes title, links, questions, and status

### 3. Knowledge Management

```typescript
// Update knowledge content
await knowledgeService.updateKnowledge(id, {
  title: 'Updated Title',
  content: 'New content...',
  links: 'https://new-link.com',
});

// Update status (approve/reject)
await knowledgeService.updateKnowledgeStatus(id, KnowledgeStatusEnum.APPROVED);

// Delete knowledge
await knowledgeService.deleteKnowledge(id);
```

## 🔍 Knowledge Processing Pipeline

### 1. Content Ingestion

```
Raw Content → Document Splitter → Chunks → OpenAI Embeddings → ChromaDB
     ↓
PostgreSQL (metadata + full content)
```

### 2. Search and Retrieval

```
User Query → OpenAI Embedding → ChromaDB Similarity Search → Ranked Results
```

### 3. Status Workflow

```
PENDING_REVIEW → APPROVED (or rejected)
     ↓
Content becomes searchable in production
```

## 📊 Data Storage Strategy

### PostgreSQL (Primary Storage)

- **knowledge** table: Full content, metadata, status
- **Relationships**: Links to external resources
- **Status tracking**: Review workflow management
- **Audit trail**: Creation and update timestamps

### ChromaDB (Vector Storage)

- **Chunk storage**: Individual content pieces
- **Embeddings**: OpenAI-generated vectors
- **Metadata**: Title, links, questions, status
- **Similarity search**: Fast vector-based retrieval

## 🚀 Getting Started

1. **Install Dependencies**: Ensure ChromaDB and PostgreSQL are running
2. **Configure Environment**: Set up OpenAI API key and database connections
3. **Run Migrations**: Initialize database schema
4. **Add Knowledge**: Use the knowledge service to add content
5. **Test Search**: Verify semantic search functionality

## 🔧 Advanced Features

### Custom Embedding Functions

```typescript
// Use custom embedding function instead of OpenAI
const customStore = new ChromaDataStore({
  collectionName: 'custom',
  embeddingFunction: new CustomEmbeddingFunction(),
});
```

### Batch Operations

```typescript
// Add multiple documents at once
await chromaStore.addDocumentsWithEmbeddings([
  { id: '1', content: 'Content 1', embedding: [...], metadata: {...} },
  { id: '2', content: 'Content 2', embedding: [...], metadata: {...} }
]);
```

### Filtered Queries

```typescript
// Search with metadata filters
const results = await chromaStore.query('query', {
  topK: 10,
  filters: { status: 'APPROVED', title: 'Impact' },
});
```

## 📈 Performance Considerations

### Optimization Strategies

- **Chunk sizing**: Balance between search precision and storage
- **Embedding caching**: Reuse embeddings for similar content
- **Index management**: Optimize ChromaDB collection settings
- **Batch processing**: Group operations for better throughput

### Monitoring

- **Search performance**: Track query response times
- **Storage usage**: Monitor ChromaDB and PostgreSQL growth
- **Embedding quality**: Evaluate search result relevance
- **System health**: Database connection and performance metrics

## 🔐 Security and Access Control

### Data Protection

- **Content encryption**: Sensitive data protection
- **Access control**: Role-based permissions
- **Audit logging**: Track all knowledge operations
- **Input validation**: Sanitize user-provided content

### Privacy Considerations

- **Content isolation**: Separate user-specific knowledge
- **Metadata filtering**: Control exposed information
- **Search privacy**: Secure query processing
- **Compliance**: GDPR and privacy regulation adherence

## 🚨 Important Notes

- **Content deduplication**: System automatically detects duplicate content
- **Status management**: Content must be approved before production use
- **Chunk management**: Deleting knowledge removes all associated chunks
- **Transaction safety**: Operations use database transactions for consistency

For detailed implementation examples and advanced usage patterns, refer to the `packages/data-store` package documentation and the knowledge service implementation in `apps/app/src/knowledge/`.
