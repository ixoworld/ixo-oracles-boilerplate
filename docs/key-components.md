# IXO Companion AI - Key Components

## Architecture Overview

The IXO Companion consists of four core engines working together to provide personalized, intelligent assistance:

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACE                       │
└─────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────┐
│                  CONTEXT ENGINE                        │
│  ┌─────────────┬─────────────┬─────────────┬───────────┐│
│  │ Personal    │ Application │ Domain      │ Location  ││
│  │ Context     │ Context     │ Context     │ Context   ││
│  └─────────────┴─────────────┴─────────────┴───────────┘│
└─────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────┐
│                 SEMANTIC ROUTER                         │
│  ┌─────────────┬─────────────┬─────────────┬───────────┐│
│  │ Information │ One-shot    │ Reasoning   │ Oracle    ││
│  │ Retrieval   │ Generation  │ Tasks       │ Delegation││
│  └─────────────┴─────────────┴─────────────┴───────────┘│
└─────────────────────────────────────────────────────────┘
          │                │                │                │
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  MEMORY ENGINE  │ │  LOCAL MODELS   │ │ REASONING MODEL │ │ ORACLE MARKETPLACE│
│                 │ │                 │ │                 │ │                   │
│ Graphiti+Matrix │ │ Llama Nemo      │ │ Enhanced Llama  │ │ Expert Agents     │
│ Neo4j Storage   │ │ Entity Extract  │ │ w/ Reasoning    │ │ Human Experts     │
│ Encrypted       │ │ Fast Inference  │ │ Prompts         │ │ MCP Servers       │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

## 1. Context Engine

### Purpose

Builds and maintains comprehensive understanding of the user and their current situation to enable highly personalized interactions.

### Components

#### Personal Context

- **Identity & Credentials**: Verifiable claims using JSON-LD schema
- **Preferences**: Communication style, language, UI preferences
- **Attributes**: Profession, interests, behavioral patterns
- **Learning**: Continuous updates from background observation

#### Application Context

- **Device Information**: Mobile, web, desktop
- **Temporal Context**: Time of day, timezone
- **Session Context**: Current task, recent activities

#### Domain Context

- **Active Domains**: Which areas user is currently working in
- **Cross-domain Relationships**: How different life areas connect
- **Domain-specific Ontologies**: Specialized vocabularies (IXO, blockchain, etc.)

#### Location Context

- **Geographic Context**: Where user is located
- **Privacy Controls**: Granular permissions for location sharing
- **Local Resources**: Nearby services and experts

### Data Model

- **Schema**: JSON-LD with schema.org types for LLM compatibility
- **Storage**: Episodes and entities in Graphiti graph structure
- **Updates**: Dynamic attribute extraction and relationship building

## 2. Memory Engine

### Purpose

Stores and retrieves conversation history, user experiences, and learned preferences with complex relationship mapping.

### Technical Stack

- **Core Technology**: Graphiti for relationship mapping
- **Integration**: Matrix events for federated storage
- **Database**: Neo4j for graph data persistence
- **Encryption**: Request-context encryption with session keys

### Features

#### Relationship Mapping

- **Entity Relationships**: "Sean bought shoes" → "shoes are torn" → update relationship
- **Temporal Updates**: Memory evolution over time with timestamps
- **Cross-references**: Connections between different memories and contexts

#### Privacy & Security

- **Encryption**: All data stored encrypted in Neo4j
- **Session Keys**: Per-oracle encryption keys stored in Matrix
- **User Control**: Granular permissions for memory sharing between oracles
- **Decryption Flow**: Decrypt → process → re-encrypt for LLM interactions

#### Cross-Oracle Memory Sharing

- **Permission System**: User toggles which memories each oracle can access
- **Context Isolation**: Health data separate from financial data
- **Smart Sharing**: Budgeting oracle can access shopping memories if permitted

### Cost Optimization

- **Small Models**: Use fine-tuned BERT/small Llama for entity extraction
- **Large Models**: Only for complex relationship building and deduplication
- **Efficiency**: 10x cost reduction, 100x speed improvement vs. full LLM processing

## 3. Semantic Router

### Purpose

Intelligently routes user requests to the most appropriate model or oracle based on intent, context, and user preferences.

### Routing Categories

#### Internal Routing (Within Companion)

1. **Information Retrieval**: Simple data fetching ("check my transactions")
2. **One-shot Generation**: Content creation, summarization
3. **Reasoning Tasks**: Complex problem solving requiring thought chains

#### External Routing (To Oracle Marketplace)

4. **Oracle Delegation**: Specialized expertise beyond companion capabilities

### Intent Classification

- **Archetypal Intents**: ~20 core intent types (summarize, analyze, plan, etc.)
- **Domain Mapping**: Intent + subject → oracle category
- **Example**: "decision support" + "personal budget" → financial planning oracle

### User Preference Filtering

- **Geographic**: Filter by oracle location/origin
- **Cost**: Free vs. paid oracle preferences
- **Verification**: Trusted vs. unverified oracle preferences
- **Previous Experience**: Learn from user feedback and usage patterns

### Technical Implementation

- **Hybrid Approach**: Embedding-based + LLM decision making
- **Context Window**: Multiple recent messages for context, not just last message
- **Semantic Search**: Vector similarity + metadata filtering
- **Ranking**: RAG-style retrieval with preference weighting

## 4. Oracle Integration Engine

### Purpose

Connects users to specialized AI agents and human experts through a unified interface and payment system.

### Oracle Types

- **AI Agents**: Specialized AI for specific domains (legal, health, technical)
- **Human Experts**: Real professionals available for consultation
- **Hybrid Services**: AI + human handoff workflows

### Integration Mechanisms

#### Agent Cards & Discovery

- **Agent-to-Agent Protocol**: Standardized service descriptions
- **Capability Declaration**: What services each oracle provides
- **Metadata**: Pricing, location, verification status, user ratings

#### MCP Server Integration

- **Hosted Servers**: IXO-managed MCP servers for common services
- **Custom URLs**: User-provided MCP endpoints
- **Service Catalog**: Google Docs, Slack, PostgreSQL, blockchain tools
- **Security**: Encrypted token storage in Matrix

### Payment & Access

- **Credit System**: Unified payment for AI and human services
- **Seamless Handoff**: AI → human expert transitions
- **Permission Management**: Granular data sharing controls
- **Service History**: Track usage and outcomes

## Model Infrastructure

### Primary Models

- **Base Models**: Llama Nemo (Nvidia optimized)
- **Hosting**: Nebius (EU, green energy, $2.50/hour H100)
- **Specialized Models**: Fine-tuned for entity extraction, domain knowledge

### Optimization Pipeline

- **Data Flywheel**: Nvidia blueprint for continuous improvement
- **Distillation**: Large model → smaller, faster models
- **LoRA Adapters**: Efficient fine-tuning for specialization
- **Human-in-the-loop**: Quality evaluation and improvement

### Deployment Options

- **Hosted**: Nebius infrastructure with tiered access
- **Self-hosted**: User-provided model endpoints
- **Hybrid**: Critical tasks hosted, routine tasks local

## Data Architecture

### Storage Distribution

- **Matrix**: Session state, encrypted events, oracle permissions
- **Neo4j**: Memory graphs, entity relationships, embeddings
- **Local**: User preferences, cached context (when appropriate)

### Privacy Principles

- **User Ownership**: All personal data belongs to user
- **Encryption**: Multiple layers, per-oracle session keys
- **Federation**: Matrix enables self-hosting and data sovereignty
- **Minimal Processing**: IXO processes minimal personal data to reduce GDPR obligations
