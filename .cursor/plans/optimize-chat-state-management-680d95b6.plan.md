<!-- 680d95b6-6c67-43fa-9963-0fe4d2117124 451e7283-376c-44a3-80d3-c573a64f176d -->
# SDK Documentation v1.0

## Phase 1: Package Review & Audit

**Audit the current package:**

- Review `src/index.ts` exports (public API surface)
- Check hook consistency and naming patterns
- Verify type exports are complete
- Review dependencies (any unused?)
- Check for circular dependencies
- Identify any confusing patterns

**Files to review:**

- `src/index.ts` - main exports
- `src/hooks/index.ts` - hook exports
- `src/providers/index.ts` - provider exports
- `package.json` - dependencies

## Phase 2: Main README

Create a compelling, clear main README:

- Quick feature overview
- Installation steps
- Basic "Hello World" example
- Links to detailed guides
- Key concepts explained simply
- Performance highlights

## Phase 3: Complete Usage Guide

Create `docs/USAGE_GUIDE.md`:

- **Getting Started**: Installation, setup, authentication
- **Chat Basics**: Creating sessions, sending messages
- **Rendering Messages**: Using `renderMessageContent` with metadata
- **Custom UI Components**: Building and registering custom components
- **Streaming**: How real-time streaming works
- **Error Handling**: Common errors and solutions
- **Best Practices**: Performance tips, patterns

## Phase 4: Live Agent Guide

Create `docs/LIVE_AGENT.md`:

- What is Live Agent (voice/video calls)
- Why it's separate (bundle size)
- Import pattern: `@ixo/oracles-client-sdk/live-agent`
- Setup voice calls
- Setup video calls
- E2EE explanation
- Browser requirements
- Troubleshooting

## Phase 5: API Reference

Create `docs/API_REFERENCE.md`:

- **Hooks**:
- `useChat` - Full API, params, return values
- `useOracleSessions` - Session management
- `useContractOracle` - Payments and authorization
- `useMemoryEngine` - Persistent context
- `useLiveAgent` - Voice/video calls
- **Components**:
- `OraclesProvider` - Context provider setup
- **Utilities**:
- `renderMessageContent` - Message renderer
- Type exports
- **Types**: Key interfaces and types

## Phase 6: Practical Examples

Create `docs/EXAMPLES.md`:

1. **Basic Chat**: Minimal working example
2. **Chat with Custom Components**: Weather widget, charts, etc.
3. **Payment Handling**: Oracle payment flow
4. **Voice Call Integration**: Adding voice calls
5. **Full-Featured App**: Complete example

## Files to Create/Update

- `README.md` - Main package README
- `docs/USAGE_GUIDE.md` - Complete usage documentation
- `docs/LIVE_AGENT.md` - Voice/video documentation  
- `docs/API_REFERENCE.md` - Full API documentation
- `docs/EXAMPLES.md` - Code examples
- `docs/ARCHITECTURE.md` - How it works (optional, for advanced users)

## Success Criteria

- Junior React dev can get started in < 5 minutes
- All public APIs documented with TypeScript examples
- Common use cases covered
- Performance characteristics explained
- Copy-paste examples that work

### To-dos

- [ ] Review and audit all exports from src/index.ts
- [ ] Review all hooks for consistency and issues
- [ ] Update main README.md with quick start
- [ ] Create comprehensive USAGE_GUIDE.md
- [ ] Create LIVE_AGENT.md documentation
- [ ] Create MIGRATION.md for breaking changes
- [ ] Create API_REFERENCE.md
- [ ] Create EXAMPLES.md with code samples