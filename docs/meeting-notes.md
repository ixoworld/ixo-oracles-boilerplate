# Meeting Notes - IXO Companion AI Planning Session

## Key Decisions Made

### 1. Memory Engine Architecture

- **Technology**: Graphiti + Matrix integration (not Mem0)
- **Storage**: Events stored as Matrix events, persisted in Neo4j
- **Encryption**: Request-context encryption with session keys per oracle
- **Cost Optimization**: Use smaller models (BERT/small Llama) for entity extraction

### 2. Model Infrastructure

- **Primary Models**: Llama Nemo (Nvidia optimized versions)
- **Hosting**: Nebius (EU-hosted, green energy, $2.50/hour H100)
- **Alternative**: Optional user-provided model endpoints (like Cursor)
- **Fine-tuning**: Nvidia Data Flywheel blueprint for continuous improvement

### 3. Data Architecture

- **Core Logic**: Stored in Matrix (LangGraph state)
- **Memories**: Neo4j with Graphiti relationships
- **Principle**: User owns all data, minimal IXO data processing
- **Goal**: Avoid GDPR complications through decentralization

### 4. Development Phases

- **Phase 1**: MVP with basic engines, IXO portal integration
- **Phase 2**: Enhanced memory relationships, advanced routing
- **Phase 3**: Full oracle ecosystem and marketplace

## Technical Insights

### Memory Engine Details

- **Graphiti Benefits**: Complex relationship mapping, temporal updates
- **Example**: "Sean bought shoes" → "shoes are torn" → relationship update with timestamp
- **Cross-Oracle Sharing**: User controls which memories each oracle can access
- **Encryption Flow**: Decrypt → process → re-encrypt for each LLM interaction

### Semantic Router Approach

- **Hybrid Method**: Combine embedding-based routing with LLM decision making
- **Context Window**: Use multiple recent messages, not just last message
- **Intent Types**: ~20 archetypal intents (summarize, analyze, plan, etc.)
- **User Preferences**: Filter by geography, cost, verification status

### Cost Management Strategy

- **Entity Extraction**: Use small, fine-tuned models (10x cost reduction)
- **Relationship Building**: Use large models only when necessary
- **Rate Limiting**: Implement usage limits like OpenAI
- **Tiered Access**: Different subscription levels with varying capabilities

## Oracle Marketplace Vision

### Expert Integration

- **AI + Human Hybrid**: Seamless handoff between AI agents and human experts
- **Credit System**: Unified payment for both AI and human services
- **Democratized Access**: Make expertise available without traditional barriers
- **Example**: Legal advice from AI → handoff to human lawyer when needed

### Service Integration

- **MCP Servers**: Host common services (Google Docs, Slack, PostgreSQL)
- **Custom Endpoints**: Users can add their own MCP URLs
- **Security**: Encrypted token storage in Matrix
- **Permission Control**: Granular data sharing settings

## Privacy & Security Priorities

### User Data Ownership

- **Principle**: Users own ALL their data
- **Storage**: Encrypted in user-controlled Matrix instances
- **Access**: IXO provides tools, not data processing services
- **Decentralization**: Matrix federation enables self-hosting

### Encryption Strategy

- **Multi-layer**: Different encryption keys for different oracles
- **Session-based**: Each oracle has its own session key
- **Matrix Storage**: Encrypted keys stored in private Matrix rooms
- **Passkey Integration**: Exploring for seamless user experience

## Personalization Features

### Deep Learning

- **Background Agent**: Async learning while companion runs
- **Communication Style**: Learn how user prefers to be addressed
- **Language Nuance**: Support for specific dialects and slang
- **Context Building**: Understand user's life domains and relationships

### Context Engine Components

1. **Personal Context**: Identity, preferences, attributes
2. **Application Context**: Device, time, location
3. **Domain Context**: Current interaction areas
4. **Location Context**: Geographic with privacy controls

## Implementation Challenges Identified

### Technical Complexity

- **Graphiti Integration**: Complex codebase requiring deep understanding
- **Encryption Implementation**: Request-context encryption needs testing
- **Matrix + Neo4j**: No existing solution for embeddings in Matrix
- **Cost Optimization**: Balance between model quality and inference costs

### User Experience

- **Passkey Limitations**: Web-tied, device loss risks, cross-platform issues
- **Self-hosting Adoption**: Average users may not be able to run local models
- **Memory Permissions**: UI for granular memory sharing controls
- **Oracle Discovery**: How users find and trust new oracles

## Next Steps Identified

### Research Needed

- **Decentralized Databases**: Explore alternatives to centralized Neo4j
- **Passkey Implementation**: Understand limitations and alternatives
- **MCP Marketplace**: Survey available MCP servers for integration
- **Entity Extraction Models**: Test small model performance vs. cost

### Development Priorities

1. **Start with Llama on Nebius**: Get basic model infrastructure running
2. **Build Core Engines**: Focus on MVP functionality first
3. **IXO Portal Integration**: Deep integration with existing platform
4. **Gradual Oracle Addition**: Add oracles incrementally, starting with IXO team needs

## Questions for Further Discussion

- How to handle memory synchronization across devices?
- What's the minimum viable encryption that provides real security?
- Which MCP servers should we prioritize for early integration?
- How do we measure and improve personalization quality?
- What oracle verification and trust mechanisms do we need?
