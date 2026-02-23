# Guide: Knowledge Store — @ixo/data-store

> **What you'll build:** A semantic knowledge base using ChromaDB (vector storage) and PostgreSQL (structured data) for your oracle to search and reference.

---

## Setup

<!-- TODO: Docker services, env vars, migrations -->

Required services: ChromaDB, PostgreSQL, and an OpenAI API key (for embeddings).

```env
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION_NAME=knowledge
POSTGRES_USER=postgres
POSTGRES_HOST=localhost
POSTGRES_DB=knowledge
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
OPENAI_API_KEY=sk-your-key
```

---

## Storing Knowledge

<!-- TODO: Content → docSplitter() → chunks → OpenAI embeddings → ChromaDB -->

---

## Semantic Search

<!-- TODO: KnowledgeService.semanticSearch() with similarity thresholds -->

---

## Integration with Memory Agent

<!-- TODO: How the memory agent uses the knowledge store -->

---

## Structured Data

<!-- TODO: Airtable integration option, PostgreSQL direct queries -->

**Source:** `packages/data-store/`
