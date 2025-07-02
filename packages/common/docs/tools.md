# Tools and Utilities Documentation

This document provides detailed information about the tools and utilities available in the `@ixo/common` package.

## Tools

### Ask IXO Guru Tool

A LangChain tool for interacting with the IXO Guru AI, which provides access to IXO's internal knowledge base.

```typescript
import { askIXOGuruTool } from '@ixo/common/ai/tools';

// Ask a question
const response = await askIXOGuruTool.invoke({
  question: "What is IXO's approach to impact tokens?",
  sessionId: 'uuid-v4-string', // To save the conversation to matrix
});
```

#### Configuration

Requires the following environment variables:

```env
IXO_GURU_QUERY_ENDPOINT=your_endpoint_url
GURU_ASSISTANCE_API_TOKEN=your_api_token
ORACLE_DID=your_oracle_did
```

#### Response Format

```yaml
answer: "The AI's response to your question"
sessionId: 'conversation-session-uuid'
```

#### Error Handling

The tool handles various error scenarios:

- Missing environment variables
- API connection issues
- Invalid session IDs
- Authentication failures

### Retriever Tool

A LangChain tool factory for creating document retrieval tools that can search and filter documents from a vector database with relevance checking.

```typescript
import { retrieverToolFactory } from '@ixo/common/ai/tools';
import { VectorDBDataStore } from '@ixo/data-store';

// Create a retriever tool
const retriever = retrieverToolFactory({
  store: vectorStore, // Your VectorDBDataStore instance
  similarThreshold: 0.3, // Optional similarity threshold
  filters: { category: 'tech' }, // Optional filters
  map: new Map(), // Optional map to store metadata
  requestId: 'unique-id', // Optional request identifier
});

// Use the tool
const docs = await retriever.invoke({
  query: "What's new in AI?",
});
```

#### Features

- Integrates with vector databases via VectorDBDataStore
- Configurable similarity threshold for initial filtering
- Additional AI-powered relevance checking for better results
- Optional metadata mapping for tracking used documents
- Support for custom filters and OpenAI models
- Returns LangChain Document objects

#### Configuration Options

```typescript
type RetrieverToolFactoryArgs = {
  model?: BaseChatModel; // Optional OpenAI model
  filters?: Record<string, unknown>; // Vector store filters
  similarThreshold?: number; // Similarity cutoff (default: 0.3)
  store: VectorDBDataStore; // Required vector store
  map?: Map<string, unknown>; // Optional metadata map
  requestId?: string; // Optional request tracking
};
```

#### Behavior

- Queries vector store with similarity search
- For threshold ≥ 0.3, performs additional AI relevance check
- Stores document metadata in provided map if configured
- Returns undefined if no documents found
- Handles errors gracefully with logging

### Web Search Tool

A LangChain tool that provides web search capabilities using the Tavily API. This tool is optimized for comprehensive, accurate, and trusted search results.

```typescript
import { webSearchTool } from '@ixo/common/ai/tools';

// Use in LangChain
const result = await webSearchTool.invoke({
  input: "What's new in AI technology?",
});
```

#### Features and Behavior

- Uses Tavily's AI-powered search engine
- Returns structured search results including:
  - Query summary
  - Top 3 most relevant results
  - Each result includes title, URL, content, and publish date
- Results are formatted in YAML for better readability for AI and ovid parsing errors
- Built-in input validation using Zod

#### Web Search Configuration

Requires the `TAVILY_API_KEY` environment variable to be set:

```env
TAVILY_API_KEY=your_api_key_here
```

#### Web Search Response Format

```yaml
query: 'your search query'
summary: 'AI-generated summary of search results'
results:
  - title: 'Result Title'
    url: 'https://result.url'
    content: 'Result content snippet'
    publishedAt: '2024-01-28'
```

## Utilities

### File Loading Utility

A versatile utility for loading and processing various types of files, supporting both local files and URLs. It automatically handles different file formats and returns processed LangChain Document objects.

```typescript
import { loadFile } from '@ixo/common/ai/utils';

// Load a local file
const pdfDocs = await loadFile('path/to/document.pdf');

// Load a file from URL with optional fetch options
const docsDocs = await loadFile('https://example.com/document.docx', {
  headers: {
    Authorization: 'Bearer token', // user OAuth token from Slack
  },
});
```

#### Supported File Types

- PDF (.pdf)
- Microsoft Word (.doc, .docx)
- Markdown (.md, .markdown)
- HTML (.html, .htm)
- Plain Text (.txt)

#### File Loading Features

- Automatic file type detection based on extension and MIME type
- Support for both local files and URLs
- Built-in error handling and logging
- Automatic text splitting using RecursiveCharacterTextSplitter
- HTML to text conversion for web content
- Returns LangChain Document objects ready for further processing

### Document Splitter

A utility for splitting text content into manageable chunks using LangChain's RecursiveCharacterTextSplitter.

```typescript
import { docSplitter } from '@ixo/common/ai/utils';

// Split a single string
const chunks = await docSplitter('Long text content...');

// Split multiple strings
const multiChunks = await docSplitter(['Text 1...', 'Text 2...']);
```

#### Document Splitter Features

- Input validation using Zod
- Supports both single string and string array inputs
- Returns array of LangChain Document objects
- Automatic error handling for empty or invalid inputs

### JSON to YAML Converter

A utility for converting JSON objects to YAML format, useful for creating human-readable configurations and outputs.

```typescript
import { jsonToYaml } from '@ixo/common/ai/utils';

const yaml = jsonToYaml({
  name: 'example',
  config: {
    enabled: true,
    values: [1, 2, 3],
  },
});
```

### Document Stringifier

A utility for converting LangChain Document objects to string format.

```typescript
import { stringifyDocs } from '@ixo/common/ai/utils';

const stringified = stringifyDocs(documents);
```

### Array Chunking

A utility for splitting arrays into smaller chunks of a specified size.

```typescript
import { chunkArr } from '@ixo/common/ai/utils';

const chunks = chunkArr([1, 2, 3, 4, 5], 2);
// Result: [[1, 2], [3, 4], [5]]
```

### Document Relevance Checker

A utility that uses LLMs to determine if a document is relevant to a given query. It's particularly useful for filtering search results and ensuring content relevance.

```typescript
import checkDocRelevance from '@ixo/common/ai/utils';

// Check document relevance
const isRelevant = await checkDocRelevance({
  doc: 'Document content or LangChain Document', // Can be string or Document
  query: 'What technologies does IXO use?',
  model: customModel, // Optional: defaults to OpenAI
});
```

#### Relevance Checker Capabilities

- Accepts both string content and LangChain Document objects
- Uses structured LLM output with Zod validation
- Customizable LLM model support
- Semantic relevance checking based on content meaning
- Built-in prompt template for consistent evaluation

#### Relevance Checker Behavior

The checker evaluates relevance based on three criteria:

1. Identifies documents completely unrelated to the query
2. Considers documents relevant if they contain related keywords or semantic meaning
3. Accepts partially relevant documents if they contain any related information

#### Usage Example with Custom Model

```typescript
import { ChatOpenAI } from '@langchain/openai';
import checkDocRelevance from '@ixo/common/ai/utils';

const customModel = new ChatOpenAI({
  modelName: 'gpt-4',
  temperature: 0,
});

const isRelevant = await checkDocRelevance({
  doc: new Document({ pageContent: 'content here' }),
  query: 'your query',
  model: customModel,
});
```

### Similarity Search Filter

A utility for filtering vector similarity search results based on a similarity threshold. This is useful for ensuring high-quality search results by removing low-similarity matches.

```typescript
import { filterSimilaritySearchResults } from '@ixo/common/ai/utils';

// Filter search results
const results: [Document, number][] = [
  [doc1, 0.8],
  [doc2, 0.4],
  [doc3, 0.9],
];

const filteredDocs = filterSimilaritySearchResults(results, 0.7);
// Returns only docs with similarity >= 0.7
```

#### Filter Capabilities

- Type-safe implementation with generics
- Works with LangChain Document objects
- Filters based on configurable threshold
- Preserves document order
- Simple and efficient filtering

#### Usage with Vector Search

```typescript
import { filterSimilaritySearchResults } from '@ixo/common/ai/utils';
import { type Document } from '@langchain/core/documents';

// Example with vector search results
type SearchResult = [Document, number];
const searchResults: SearchResult[] = await vectorStore.similaritySearch(query);

// Filter results with similarity >= 0.8
const highQualityResults = filterSimilaritySearchResults(searchResults, 0.8);
```
