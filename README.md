# IXO Oracles Base Repository

Welcome to our comprehensive, modular framework for building and deploying AI-driven oracles. This repo consolidates essential modules (data storage, vector search, knowledge management, authentication, client SDK, real-time events, etc.) into a single, well-structured codebase. Whether you're creating a new oracle from scratch or extending existing solutions, this repository provides the tooling and best practices to streamline development.

---

## Key Features

1. **🔒 Secure Communication**

   - End-to-end encrypted Matrix rooms
   - Secure WebSocket events
   - API key management

2. **📊 Data Management**

   - Vector database support (ChromaDB)
   - Structured data storage (Airtable)
   - Type-safe interfaces

3. **🤖 AI Integration**

   - OpenAI integration
   - Semantic search capabilities
   - Document processing tools

4. **🔄 Real-time Features**
   - Event-driven architecture
   - WebSocket communication
   - Matrix & Slack integration

## Package Overview

Here's a detailed overview of the key packages in this repository:

### Core Packages

1. **@ixo/common** - [`packages/common`](./packages/common)

   - Core utilities, AI capabilities, and shared services
   - Matrix integration and state management
   - OpenAI integration and document processing
   - Environment variables:

     ```env
     OPENAI_API_KEY=your_openai_key
     MATRIX_ORACLE_ADMIN_ACCESS_TOKEN=your_matrix_token
     TAVILY_API_KEY=your_tavily_key  # Optional for web search
     ```

2. **@ixo/data-store** - [`packages/data-store`](./packages/data-store)

   - Vector and structured data storage abstractions
   - ChromaDB and Airtable implementations
   - Environment variables:

     ```env
     OPENAI_API_KEY=your_openai_api_key    # For embeddings
     AIRTABLE_API_KEY=your_airtable_key    # For Airtable operations
     AIRTABLE_BASE_ID=your_base_id         # For Airtable operations
     AITABLE_BASE_TABLE_LINK=your_link     # Optional for record links
     ```

3. **@ixo/matrix** - [`packages/matrix`](./packages/matrix)

   - Secure Matrix.org client SDK wrapper
   - End-to-end encrypted room management
   - Required environment variables:

     ```env
     MATRIX_BASE_URL=https://your-matrix-server.com
     MATRIX_ORACLE_ADMIN_ACCESS_TOKEN=your_token
     MATRIX_ORACLE_ADMIN_USER_ID=@admin:your.server
     MATRIX_ORACLE_ADMIN_PASSWORD=your_password
     MATRIX_RECOVERY_PHRASE=your_recovery_phrase
     ```

   - Optional storage paths (created in `matrix-local-storage` folder):
     ```env
     MATRIX_CRYPTO_STORE_PATH=./matrix-crypto-store        # Crypto storage
     MATRIX_STORE_PATH=./matrix-store                      # General storage
     MATRIX_SECRET_STORAGE_KEYS_PATH=./matrix-secret-storage  # Secret keys
     ```

4. **@ixo/oracles-events** - [`packages/events`](./packages/events)

   - Real-time event system for oracle communications
   - WebSocket-based client communication

5. **@ixo/slack** - [`packages/slack`](./packages/slack)

   - Slack integration using Bolt SDK
   - Rich messaging capabilities
   - Environment variables:

     ```env
     SLACK_BOT_TOKEN=xoxb-your-bot-token
     SLACK_APP_TOKEN=xapp-your-app-token
     ```

### Supporting Packages

6. **@ixo/oracles-chain-client** - [`packages/oracles-chain-client`](./packages/oracles-chain-client)

   - Blockchain interaction client
   - Credentials management

7. **@ixo/api-keys-manager** - [`packages/api-keys-manager`](./packages/api-keys-manager)

   - API key management and validation

8. **@ixo/logger** - [`packages/logger`](./packages/logger)

   - Centralized logging functionality

9. **Configuration Packages**
   - `@ixo/jest-config`: Jest testing configuration
   - `@ixo/eslint-config`: ESLint rules
   - `@ixo/typescript-config`: TypeScript configuration

---

## Prerequisites

Before you begin, ensure you have:

- Node.js 16+ installed
- Docker (for running ChromaDB)
- Access to a Matrix server (for secure communication)
- Required API keys (OpenAI, Airtable, etc.)
- pnpm installed (`npm install -g pnpm`)

## Getting Started

1. **Clone or Fork the Repo**

   ```sh
   git clone https://github.com/ixoworld/ixo-oracles-boilerplate
   cd ixo-oracles-boilerplate
   ```

2. **Install Dependencies**

   ```sh
   pnpm install
   ```

   (Alternatively, use `npm install` or `yarn install` if preferred.)

3. **Build the Project**

   ```sh
   pnpm build
   ```

4. **Run Tests**
   ```sh
   pnpm test
   ```

---

## Development Workflow

### Local Development

1. **Start Required Services**

   ```sh
   # Start ChromaDB
   docker run -p 8000:8000 chromadb/chroma
   ```

   - Start Matrix server (if running locally) following setup instructions.

2. **Running Tests**

   ```sh
   # All tests
   pnpm test

   # Single package
   pnpm test --filter @ixo/events
   ```

---

## Environment Setup

1. **Copy Environment Variables Template**

   ```sh
   cp .env.example .env
   ```

   This creates a local `.env` file from the template.

2. **Configure Environment Variables**
   Update the `.env` file with your specific configuration values.

3. **Security Notes**

   - Never commit the `.env` file
   - Use secure methods to share environment variables in production
   - Consider using a secrets manager for production deployments

4. **Local Development**

   - ChromaDB can be run locally using Docker:

     ```sh
     docker run -p 8000:8000 chromadb/chroma
     ```

   - Matrix server can be local or remote, but must support end-to-end encryption.

## Testing & Coverage

- **Unit Tests**: Each package includes or will include basic unit tests.
- **Integration Tests**: Certain workflows (e.g., Knowledge Module syncing Airtable + Vector DB) may have additional tests in the `tests/` folder.
- **Coverage Goals**:
  - **Core Modules**: 100% if possible (session management, core oracles logic).
  - **Others**: ~75% coverage to ensure stability.

Use `pnpm test` to generate coverage reports.

---

## Contributing

1. **Open an Issue**: Start a discussion or propose a feature/bugfix.
2. **Create a Feature Branch**: For new features or significant refactors.
3. **Submit a Pull Request**: Include clear commit messages and reference any related issues.
4. **Code Review**: Team members will review and provide feedback. Ensure passing tests and updated documentation.

We adhere to **ESLint** and **Prettier** standards to maintain a clean, consistent codebase.

---

## Roadmap & Next Steps

- **Finalize Module Test Coverage**
- **Improve Documentation**
- **Refine Auth**
- **Evolve Events Module**

---

## Contact & Support

- **Issues & Bugs**: [GitHub Issues](https://github.com/ixoworld/ixo-oracles-boilerplate/issues)
- **Questions & Discussion**: [GitHub Discussions](https://github.com/ixoworld/ixo-oracles-boilerplate/discussions)

---

We hope this base repository accelerates your AI oracle development. Happy building!!
