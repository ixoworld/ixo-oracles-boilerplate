# **ixo Oracles Base Repository**

Welcome to the **ixo Oracles Base Repository**—a comprehensive, modular framework for building and deploying AI-driven oracles. This repo consolidates essential modules (data storage, vector search, knowledge management, authentication, client SDK, etc.) into a single, well-structured codebase. Whether you’re creating a new oracle from scratch or extending existing solutions, this repository provides the tooling and best practices to streamline development.

---

## **Key Features**

1. **Modular Architecture**  
   Each major function (e.g., Data Store, Vector DB, Knowledge Module, Auth) is in its own package for easy maintenance and reuse.

2. **High Test Coverage**  
   Emphasis on automated testing to ensure reliability and maintainability. Certain core modules aim for **100% coverage**, while others target **75%+**.

3. **Flexible Integrations**  
   - **Data-Store** integrates seamlessly with structured data sources (e.g., Airtable).  
   - **Vector DB** modules (Chroma, Pinecone) support embedding-based search and retrieval.  
   - **Knowledge Module** centralizes domain-specific data, easily syncable with external sources.

4. **Client SDK**  
   Formerly `@ixo/oracles-ui`, now refactored as a **generic** SDK for interactive oracle sessions, dynamic UI rendering, and real-time communication.

5. **Security & Auth**  
   An **Auth module** ensures that oracles only perform actions when properly authorized, keeping user data secure.

---

## **Repository Structure**

```plaintext
.
├── packages/
│   ├── auth/               # Auth module for permission checks
│   ├── data-store/         # CRUD interface for structured data (e.g., Airtable)
│   ├── knowledge/          # Knowledge Module for domain data management
│   ├── vector-db/          # Interfaces & implementations for embedding-based DBs
│   ├── oracles-client-sdk/ # React hooks & utilities for oracle UIs
│   └── ...other packages
├── docs/                   # Documentation (to be expanded)
├── tests/                  # Centralized tests & integration checks
├── .eslintrc               # Lint rules
├── jest.config.js          # Testing config
├── tsconfig.json           # TypeScript configuration
├── package.json
└── README.md               # This file
```

- Each **package** contains its own `README` (where applicable), configuration, and tests.
- The **docs** directory is ideal for usage guides, architecture overviews, and advanced tutorials.

---

## **Getting Started**

1. **Clone or Fork the Repo**  
   ```bash
   git clone https://github.com/ixoworld/ixo-oracles-boilerplate
   cd ixo-oracles-boilerplate
   ```

2. **Install Dependencies**  
   ```bash
   pnpm install
   ```
   (Alternatively, use `npm install` or `yarn install` if preferred.)

3. **Build the Project**  
   ```bash
   pnpm build
   ```
   This compiles the TypeScript packages into distributable artifacts.

4. **Run Tests**  
   ```bash
   pnpm test
   ```
   - Includes both unit and (where implemented) integration tests.  
   - Coverage reports can be generated to maintain quality standards.

---

## **Usage & Modules**

Below is a quick overview of each major module. More detailed instructions are in each package’s local `README`.

1. **Auth Module**  
   - **Purpose:** Validates whether an oracle is authorized to perform actions for a user.  
   - **Usage:** Integrate permission checks (e.g., `checkPermission(user, action)`) in your service layer.

2. **Data-Store Module**  
   - **Purpose:** Provides a straightforward CRUD interface, often used with Airtable or other structured data sources.  
   - **Usage:** Import the `IDataStore<T>` interface and implement your logic (create, read, update, delete).

3. **Knowledge Module**  
   - **Purpose:** Manages domain-specific knowledge, syncing data between structured sources (Airtable) and vector stores if needed.  
   - **Usage:** Call the module’s CRUD functions to update or retrieve knowledge items.

4. **Vector DB Module**  
   - **Purpose:** Abstracts embedding-based search and retrieval with vector databases (e.g., Pinecone, Chroma).  
   - **Usage:** Implement the `IVectorDB<T>` interface in your chosen DB package. Store or query embeddings seamlessly.

5. **Oracles Client SDK**  
   - **Purpose:** Provides hooks and components for real-time AI interactions (sessions, dynamic UI, message streaming).  
   - **Usage:** Wrap your React app in `UseOraclesProvider` for centralized config, then use hooks like `useAskOracle`.

---

## **Configuration**

- **Environment Variables & Secrets**:  
  Each package may rely on environment variables (e.g., Airtable API keys, vector DB credentials). Provide them in a `.env` file or through a secure vault service.
  
- **Provider-Based Approach** (e.g., `UseOraclesProvider` for the client SDK):  
  - Pass all relevant configuration (API URLs, auth tokens) in one place, reducing duplication and simplifying maintenance.

---

## **Testing & Coverage**

- **Unit Tests**: Each package includes or will include basic unit tests.  
- **Integration Tests**: Certain workflows (e.g., Knowledge Module syncing Airtable + Vector DB) may have additional tests in the `tests/` folder.  
- **Coverage Goals**:  
  - **Core Modules**: 100% if possible (session management, core oracles logic).  
  - **Others**: ~75% coverage to ensure stability.  

Use `pnpm test:coverage` (or a similar script) to generate coverage reports.

---

## **Contributing**

1. **Open an Issue**: Start a discussion or propose a feature/bugfix.  
2. **Create a Feature Branch**: For new features or significant refactors.  
3. **Submit a Pull Request**: Include clear commit messages and reference any related issues.  
4. **Code Review**: Team members will review and provide feedback. Ensure passing tests and updated documentation.

We adhere to **ESLint** and **Prettier** standards to maintain a clean, consistent codebase.  

---

## **Roadmap & Next Steps**

- **Finalize Module Test Coverage**: Reach 75%+ coverage on new modules, 100% on critical ones.  
- **Expand Vector DB Integrations**: Provide more out-of-the-box support for popular embeddings.  
- **Improve Documentation**: Deeper guides, advanced usage scenarios, best practices.  
- **Refine Auth**: Clarify roles, permissions, and token-based flows.  

Keep an eye on the `docs/` directory and upcoming issues or tickets for further developments.



## **Contact & Support**

- **Issues & Bugs**: [GitHub Issues](https://github.com/ixoworld/ixo-oracles-boilerplate/issues)  
- **Questions & Discussion**: [GitHub Discussions](https://github.com/ixoworld/ixo-oracles-boilerplate/discussions) or Slack/Discord (if applicable)  

---

**We hope this base repository accelerates your AI oracle development.** If you have any questions, suggestions, or run into problems, don’t hesitate to open an issue. Happy building!