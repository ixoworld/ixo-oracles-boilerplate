# Events System Architecture

## 📖 Overview

The `@ixo/oracles-events` package is the real-time communication backbone of QiForge. It handles streaming communication between your oracle (server) and client applications through Server-Sent Events (SSE) and WebSocket (WS) connections.

**Key Capabilities:**

- **Real-time Tool Execution Updates**: Stream tool call status to clients
- **Dynamic UI Component Rendering**: Render custom React components from LLM responses
- **Browser Tool Calls**: Execute tools directly in the user's browser (reverse tool calls)
- **Session Management**: Automatic isolation and request tracking
- **Type-Safe Communication**: Full TypeScript support with payload validation

## 🚀 Getting Started

For complete documentation, usage examples, implementation guides, and technical details, please refer to:

**👉 [`@ixo/oracles-events` Package Documentation](../../packages/events/README.md)**

The package README contains:

- ✅ **Usage Examples** - How to create and emit events
- ✅ **Event Types** - Complete reference for all available events
- ✅ **Integration Patterns** - SSE vs WebSocket usage
- ✅ **Flow Diagrams** - Visual representation of event flow
- ✅ **Advanced Usage** - Custom events and complex patterns
- ✅ **API Reference** - Complete TypeScript interfaces

---

_This architecture overview provides a high-level understanding. All implementation details, code examples, and technical specifications are maintained in the package documentation._
