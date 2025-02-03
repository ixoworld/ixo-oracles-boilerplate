# AI Module Documentation

## Overview

The AI module in `@ixo/common` provides a suite of AI-powered tools and utilities designed to extend the capabilities of ixo oracles. It integrates with OpenAI and LangChain for language model interactions, document processing, semantic routing, and includes various utility functions.

## Components

### 1. Checkpointing

The checkpointing system enables persistence of LangChain graph states using SQLite. Optionally, you can also integrate with Matrix-based checkpointing by importing from `@ixo/matrix`.

```typescript
import { SqliteSaver } from '@ixo/common/ai';

const checkpointer = new SqliteSaver('./checkpoints');
const graph = workflow.compile({
  checkpointer,
});
```

### 2. Nodes

#### Find Docs Node

this node to be used to find the most relevant documents from a vector database with langgraph

#### Fake Node

this node is a fake node to pass the state to the next node

### 3. Semantic Routing

The semantic router creates intelligent routing based on content analysis using OpenAI:

```typescript
import { createSemanticRouter } from '@ixo/common/ai';

const routes = {
  generateBlog: 'if the intent is blog',
  generateSocialMediaPost: 'if the intent is post',
};

const router = createSemanticRouter(routes, ['intent'], 'gpt-4o-mini');

// Use the router
const nextRoute = await router({
  intent: 'Create a blog post about AI',
});
```

Features:

- Type-safe route creation and validation
- Supports 'gpt-4o-mini' and 'gpt-4o' models
- Handles complex routing scenarios
- Integrated with LangSmith for tracing

### 4. OpenAI Integration

The module provides convenient OpenAI model factories:

```typescript
import {
  getChatOpenAiModel,
  getOpenAiEmbeddings,
  getRawOpenAiModel,
} from '@ixo/common/ai/models';

// Get a ChatOpenAI instance
const chatModel = getChatOpenAiModel();

// Get embeddings model
const embeddings = getOpenAiEmbeddings({
  model: 'text-embedding-3-small',
});

// Get raw OpenAI client
const openai = getRawOpenAiModel();
```

### 5. Tools & Utilities

For detailed documentation on available tools, please refer to the [Tools Documentation](./tools.md).
