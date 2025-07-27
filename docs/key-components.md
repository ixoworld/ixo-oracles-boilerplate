# IXO Companion AI - Key Components

## Architecture Overview

The IXO Companion consists of four core engines working together to provide personalized, intelligent assistance:

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACE                       │
└─────────────────────────────────────────────────────────┘
                              │
┌────────────────────────────────────────────────────────────────────────┐
│                  CONTEXT ENGINE                                        │
│  ┌─────────────┬─────────────┬─────────────┬───────────┐               │
│  │ Personal    │ Application │ Domain      │ Location  │               │
│  │ Context     │ Context     │ Context     │ Context   │               │
│  └─────────────┴─────────────┴─────────────┴───────────┘               │
└────────────────────────────────────────────────────────────────────────┘
                                     │
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │                 SEMANTIC ROUTER                                                 │
  │  ┌───────────────┬───────────────┬───────────────┬─────────────┐─────────────┐  │
  │  │ Information   │ One-shot      │ Reasoning     │ Oracle      │ Custom      │  │
  │  │ Retrieval     │ Generation    │ Tasks         │ Delegation  │ Commands[/] │  │ 
  │  └───────────────┴───────────────┴───────────────┴─────────────┘─────────────┘  │
  └─────────────────────────────────────────────────────────────────────────────────┘
          │                │                │                │                     │
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  MEMORY ENGINE  │ │  LOCAL MODELS   │ │ REASONING MODEL │ │ ORACLE REGISTRY   │ │ COMMAND CENTER    │
│                 │ │                 │ │                 │ │                   │ │                   │
│ Graphiti+Matrix │ │ Llama Nemo      │ │ Enhanced Llama  │ │ Expert Agents     │ │ System Commands   │
│ Neo4j Storage   │ │ Entity Extract  │ │ w/ Reasoning    │ │ Human Experts     │ │ Own Commands      │
│ Encrypted       │ │ Fast Inference  │ │ Prompts         │ │ MCP Servers       │ │ Community Commands│
└─────────────────┘ └─────────────────┘ └─────────────────┘ └───────────────────┘ └───────────────────┘
```

## 1. Context Engine

### Purpose

Builds and maintains comprehensive understanding of the user and their current situation to enable highly personalized interactions.

### Components

#### Personal Context

- **Identity & Credentials**: Verifiable claims using JSON-LD schema
- **Preferences**: Communication style, Language, UI preference settings
- **Attributes**: Profession, interests, behavioral patterns
- **Flows**: Personal workflows, state

#### Application Context

- **Device Details**: Mobile, web, desktop, Operating System
- **App Identifier**: Portal, JAMBO, Third-party
- **Ecosystem**: Market Relayer DID, Ecosystem name
- **Temporal Context**: Time of day, timezone
- **Session State**: Last sign-in time, Current task, recent activities

#### Domain Context

- **Active Domains**: Which entities (DIDs) the user is currently interacting with 
- **Relationships**: Domain → Role mapping
- **Domain-specific Ontologies**: Specialized vocabularies (IXO, blockchain, etc.)

#### Location Context

- **Geographic Location**: Current geo-location, Home and work locations
- **Privacy Controls**: Granular Object Capability permissions for location sharing
- **Local Resources**: Nearby services, contacts, experts

### Data Model

- **Schema**: JSON-LD with schema.org types for LLM compatibility
- **Storage**: Episodes and entities in Graphiti graph structure
- **Updates**: Dynamic attribute extraction and relationship building

## 2. Memory Engine

### Purpose

Stores and retrieves conversation history, user experiences, and learned preferences with complex relationship mapping.

### Technical Stack

- **Core Technology**: [Graphiti](https://github.com/getzep/graphiti) for relationship mapping
- **Integration**: Matrix events for E2EE federated storage
- **Database**: Neo4j for graph data persistence
- **Encryption**: Request-context encryption with session keys

### Features

#### Relationship Mapping

- **Entity Relationships**: "Bob bought shoes" → "shoes are torn" → update relationship
- **Temporal Updates**: Memory evolution over time with timestamps
- **Cross-references**: Connections between different memories and contexts

#### Privacy & Security

- **Encryption**: All data stored encrypted in Neo4j
- **Session Keys**: Per-oracle encryption keys stored in Matrix
- **User Control**: Granular Object-Capability based permissions for memory sharing between oracles
- **Decryption Flow**: Decrypt → process → re-encrypt for LLM interactions

#### Cross-Oracle Memory Sharing

- **Permission System**: User toggles which memories each oracle can access, only accessible through the Agentic Web of Trust
- **Context Isolation**: Health data separate from financial data
- **Memory-Sharing**: Budgeting oracle can access shopping memories if permitted

### Cost Optimization

- **Small Models**: Use fine-tuned BERT/small Llama for entity extraction
- **Large Models**: Only for complex relationship building and deduplication
- **Efficiency**: 10x cost reduction, 100x speed improvement vs. full LLM processing

## 3. Semantic Router

### Purpose

Intelligently routes user requests to the most appropriate model, oracle, or other domain, based on intent, context, and user preferences.

### Routing Types and Categories

#### Companion Oracle ("internal to my domain")

1. **Information Retrieval**: Functions to get data ("check my transactions")
2. **One-shot Generation**: Content creation, summarization
3. **Reasoning Tasks**: Complex problem solving requiring chain-of-thought and misxture of experts reasoning
4. **Commands**: Custom system prompts ("/Analyse Results for..."), Custom personal prompts ("/Latest News About..."), Custom community prompts ("/Compare Results with...")   

#### Domains and the Agentic Web ("external to my domain")

1. **Agentic Oracle Delegation**: Contracts specialized services provided by third-party agentic oracles within the Agentic Web of Trust
2. **Domain Interface**: Interact through MCP with entities such as DOAs, Projects, Assets, Investments, Locations, Protocols, and Deeds
3. **Agent Interface**: Directly communicate with LLM models and agentic services outside the Agentic Web of Trust → A2A Protocol for discovery and messaging
4. **Natural Language Web Interface**: Directly interact with websites that are NLWeb enabled

### Examples 
* "Help me balance my budget": "decision support" + "personal budget" → financial planning oracle
* "Tell me about SupaMoto": "supamoto" + "asset" → SupaMoto Asset Collection Domain
* "Ask ChatGPT": "ChatGPT" + "Prompt" → OpenAI API prompt-completion
* "Check the IXO documentation site": "Web Search" + "IXO Documentation" → search and resolve web URL for llms.txt or NLWeb "Ask" (if available)

### Intent Classification

- **Universal Intents**: ~20 intent types (summarize, analyze, plan, etc.)
- **Commands**: Custom Intents invoked by `/` (slash/command) through the user interface → maps to registries of System (app instance), Personal (Matrix store), and Community (domain) commands
- **Domain Mapping**: Description → Entity Type extraction → Entity DID semantic lookup → Entity Profile → Entity MCP

### User Preference Matching

- **Geographic**: Filter by domain location/origin
- **Cost**: Free vs. fee-for-service oracle preferences, maximum budget
- **Trust**: Trusted vs. unverified oracle preferences
- **Rating**: Learn from user feedback and usage patterns
- **Attributes**: Such as specific area of expertise

### Technical Implementation

- **Hybrid Approach**: Embedding-based search + RAG with LLM decision-making
- **Context Window**: Multiple recent messages for context, not only the last message
- **Semantic Search**: Vector similarity + metadata filtering
- **Ranking**: RAG-style similarity retrieval and ranking, with preference weighting

## 4. Oracle Integration Engine

### Purpose

Connects users to specialized AI agents and human experts in the Agentic Web of Trust through a unified A2A interface and payment system.

### Oracle Types

- **Agentic Oracles**: Specialized AI for specific domains (legal, health, technical)
- **Human Experts**: Live professionals available for consultation
- **Augmented Services**: AI + human handoff workflows

### Integration Mechanisms

#### Agent Cards & Discovery

- **Agent-to-Agent Protocol**: Standardized service descriptions and attributes, extended with Verifiable Credentials for Agentic Web of Trust
- **Capability Declaration**: What services each oracle provides
- **Metadata**: Pricing, location, verification status, user ratings

#### MCP Server Integration

- **Hosted Servers**: IXO-managed MCP servers for Agentic Web of Trust service integrations
- **Custom URLs**: User-provided MCP endpoints
- **Service Catalog**: Google Docs, Slack, PostgreSQL, blockchain tools
- **Security**: Encrypted auth token storage in Matrix

### Payment & Access

- **Platform Credits**: Digital payments for AI and human services, with accepted token denominations and prices specified by each service
- **Seamless Handoff**: AI → human expert transitions through Matrix `Issue` event type, with standard issue-management system schemas
- **Permission Management**: Granular user-controlled authorization (UCAN) tokens for data-sharing and service access
- **Service Log**: Tracks usage, actions taken, and outcomes in an E2EE Matrix room controlled by the user

## Model Infrastructure

### Primary Models

- **Base Models**: Llama Nemo (Nvidia optimized)
- **Hosting**: Nebius (EU, green energy, $2.50/hour H100)
- **Specialized Models**: Fine-tuned for entity extraction, domain knowledge
- **IP Adapters**: Sovereign fine-tuned LoRA adapters

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

- **Matrix**: Session state, encrypted events, oracle permissions → UCAN and Auth tokens
- **Neo4j**: Memory graphs, entity relationships, embeddings
- **Local**: User preferences, cached context (when appropriate)

### Privacy Principles

- **Data Sovereignty**: All personal data belongs to the user and is never used for improving services or models, without explicit user Consent → signed and logged Consent Receipts
- **Encryption**: Multiple layers, per-oracle session keys
- **Federation**: Matrix enables self-hosting (including browser-based Matrix severs) and data sovereignty
- **Minimal Processing**: IXO processes minimal personal data to reduce GDPR obligations
