# Editor Agent

`createEditorAgent` wraps the BlockNote/Matrix toolchain into a DeepAgents-ready
sub-agent so other graphs can delegate document work without re-implementing the
setup every time.

## Usage

```ts
import { createEditorAgent } from 'src/graph/agents/editor/editor-agent';

const editorAgent = await createEditorAgent({
  room: '!roomId:ixo.chat',
  mode: 'edit', // or 'readOnly'
});

const response = await editorAgent.invoke({
  messages: [
    {
      role: 'user',
      content: 'List all proposals and mark proposal #3 as open.',
    },
  ],
});
```

- Pass a Matrix room ID (or `{ type: 'alias', value: '#alias:domain' }`) via
  the `room` parameter.
- Use `mode: 'readOnly'` to restrict the agent to the `list_blocks` tool.
- Advanced deployments can override any portion of the default
  `BLOCKNOTE_TOOLS_CONFIG` with `configOverrides`.

The agent automatically reuses the shared `EditorMatrixClient`, enforces the
list-before-edit workflow from `editorAgentPrompt`, and applies the standard
DeepAgents middlewares (filesystem, to-do tracking, summarization).
