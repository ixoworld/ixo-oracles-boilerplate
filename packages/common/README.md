# @ixo/common

## Overview

The `@ixo/common` package serves as a foundational library for the ixo-oracles ecosystem, providing shared utilities, AI capabilities, and core services. It integrates with Matrix for communication and state management, OpenAI for AI capabilities, and provides various tools for document processing and semantic analysis.

## Table of Contents

1. [Getting Started](#getting-started)
   - [Installation](#installation)
   - [Basic Usage](#basic-usage)
2. [Core Components](#core-components)
   - [AI Module](#ai-module)
   - [Services](#services)
3. [Documentation](#documentation)

## Getting Started

### Installation

```bash
# Install using pnpm (recommended)
pnpm install @ixo/common

# Or using npm
npm install @ixo/common

# Or using yarn
yarn add @ixo/common
```

### Environment Setup

The package requires several environment variables:

```env
# OpenAI Configuration
OPENAI_API_KEY=your_openai_key

# Matrix Configuration
MATRIX_ORACLE_ADMIN_ACCESS_TOKEN=your_matrix_token

# Optional Tools Configuration
TAVILY_API_KEY=your_tavily_key  # For web search capabilities
```

### Basic Usage

```typescript
// Services for Matrix room and session management
import {
  RoomManagerService,
  SessionManagerService,
} from '@ixo/common/services';

// Initialize services
const sessionManager = new SessionManagerService();
const roomManager = new RoomManagerService();

// Create or get a Matrix room
const roomId = await roomManager.getOrCreateRoom({
  did: 'user-did',
  oracleName: 'oracle-name',
  userAccessToken: 'matrix-token',
});

// Manage chat sessions
const session = await sessionManager.createSession({
  did: 'user-did',
  oracleName: 'oracle-name',
  matrixAccessToken: 'matrix-token',
});

// AI utilities
import {
  docSplitter,
  checkDocRelevance,
  createSemanticRouter,
  webSearchTool,
} from '@ixo/common/ai';

// Process documents
const chunks = await docSplitter('Long text content...');

// Check document relevance
const isRelevant = await checkDocRelevance({
  doc: 'document content',
  query: 'search query',
});

// Create semantic routes
const router = createSemanticRouter({
  routes: {
    generateBlog: 'if the intent is blog',
    generatePost: 'if the intent is post',
  },
  basedOn: ['intent'],
});
```

## Core Components

### AI Module

The AI module provides a comprehensive suite of AI-powered tools and utilities:

- **Document Processing**
  - Text splitting and chunking
  - Document relevance checking
  - File loading and format conversion
  - Similarity search filtering

- **Semantic Routing**
  - Intent-based routing
  - OpenAI integration
  - LangSmith tracing support

- **Search and Retrieval**
  - Web search integration with Tavily
  - Vector similarity search
  - Document retrieval tools

- **Utility Functions**
  - YAML/JSON conversion
  - Document stringification
  - Array manipulation

### Services

Core services for Matrix integration and state management:

- **Room Manager**
  - Matrix room creation and retrieval
  - DID-based room management
  - Access control and validation

- **Session Manager**
  - Chat session management
  - AI-powered session titling
  - Matrix state persistence
  - Session lifecycle handling

- **Environment Service**
  - Type-safe environment variable management
  - Zod schema validation
  - Singleton pattern implementation
  - Runtime environment validation

### Using the Environment Service

The Environment Service provides a type-safe way to manage and access environment variables in your application. Here's the recommended way to structure and use it:

#### 1. Define Your Schema (schema.ts)

```typescript
// src/services/env/schema.ts
import z from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().transform(Number),
  API_KEY: z.string().min(1),
  // Add more environment variables as needed
});

// Export the schema type for type-safety
export type Schema = typeof envSchema;
```

#### 2. Create Singleton Instance (env.ts)

```typescript
// src/services/env/env.ts
import { type Schema } from 'zod/v3';
import { EnvService } from './env.service';

const envService = EnvService.getInstance<Schema>();

export default envService;
```

#### 3. Initialize in Application Entry Point

```typescript
// src/main.ts or src/app.ts
import { EnvService } from '@ixo/common/services/env';
import { envSchema } from './services/env/schema';

async function bootstrap() {
  // Initialize environment service first
  EnvService.initialize(envSchema);

  // Now you can start your application
  const app = express();
  // ... rest of your application setup
}

bootstrap();
```

#### 4. Use Throughout Your Application

```typescript
// Any file where you need env variables - use the singleton instance you created in your app
import env from './services/env/env';

// Type-safe environment usage
const port = env.get('PORT'); // TypeScript knows this is a number
const apiKey = env.get('API_KEY'); // TypeScript knows this is a string

// Example usage in a service
export class DatabaseService {
  constructor() {
    this.connect({
      port: env.get('PORT'),
      apiKey: env.get('API_KEY'),
    });
  }
}
```

This pattern provides several benefits:

- **Single Source of Truth**: Environment schema is defined in one place
- **Type Safety**: TypeScript knows the types of all environment variables
- **Early Validation**: Environment is validated when the application starts
- **Clean Imports**: Simple import of the pre-configured service
- **Separation of Concerns**: Schema definition, initialization, and usage are separated

## Documentation

Detailed documentation is available in the [docs](./docs) directory:

- [AI Module Documentation](./docs/ai-module.md) - AI tools and utilities
- [Services Documentation](./docs/services.md) - Matrix services
- [Tools Documentation](./docs/tools.md) - Utility tools and helpers

## License

Internal package - All rights reserved.
