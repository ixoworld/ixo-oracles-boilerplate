/* eslint-disable no-console */
/**
 * LangChain Tools for BlockNote Y.js Editing
 */

import { tool } from '@langchain/core/tools';
import * as z from 'zod';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MatrixClient } from 'matrix-js-sdk';
import { randomUUID } from 'node:crypto';
import { type ENV } from 'src/config';
import * as Y from 'yjs';
import {
  appendBlock,
  collectAllBlocks,
  deleteBlock,
  editBlock,
  evaluateBlockConditions,
  extractBlockProperties,
  findBlockById,
  getBlockDetail,
  readAuditTrailForBlock,
  readDelegations,
  readFlowMetadata,
  readFlowNodes,
  readInvocations,
  readRuntimeState,
  resolveBlockReferences,
  simplifyBlockForAgent,
  updateRuntimeState,
  type BlockSnapshot,
  type ConditionConfig,
} from './blocknote-helper';
import { type AppConfig, MatrixProviderManager } from './provider';
import {
  extractSurveyQuestions,
  getMissingRequiredFields,
  getVisibleQuestions,
  type SurveySchema,
  validateAnswersAgainstSchema,
} from './survey-helpers';
import {
  getAction,
  getAllActions,
  buildFlowNodeFromBlock,
  executeNode,
  type ActionServices,
  type FlowRuntimeStateManager,
  type FlowNodeRuntimeState,
} from '@ixo/editor/core';

const configService = new ConfigService<ENV>();

const matrixConfig = {
  baseUrl: configService.getOrThrow('MATRIX_BASE_URL'),
  accessToken: configService.getOrThrow('MATRIX_ORACLE_ADMIN_ACCESS_TOKEN'),
  userId: configService.getOrThrow('MATRIX_ORACLE_ADMIN_USER_ID'),
  initialSyncTimeoutMs: 30_000,
} as const;

export const BLOCKNOTE_TOOLS_CONFIG = {
  matrix: matrixConfig,
  provider: {
    docName: 'document',
    enableAwareness: false,
    retryAttempts: 3,
    retryDelayMs: 5_000,
  },
  blocknote: {
    defaultBlockId: undefined,
    blockNamespace: undefined,
    mutableAttributeKeys: [],
  },
};

/**
 * Track active provider managers for cleanup
 */

const logger = new Logger('BlocknoteTools');

// ── DID Helpers ───────────────────────────────────────────────────────

/**
 * Extracts a valid DID from a Matrix user ID.
 * Matrix format: @did-ixo-ixo1abc123def:mx.server.com
 * Result:        did:ixo:ixo1abc123def
 *
 * The localpart encodes the DID with hyphens instead of colons.
 */
function matrixUserIdToDid(matrixUserId: string): string {
  // Strip leading @ and remove homeserver (:server.com)
  const localpart = matrixUserId.replace(/^@/, '').replace(/:.*$/, '');
  // Convert hyphens back to colons: did-ixo-ixo1abc → did:ixo:ixo1abc
  // Only replace the first two hyphens (did-method-identifier)
  const parts = localpart.split('-');
  if (parts.length >= 3 && parts[0] === 'did') {
    return `${parts[0]}:${parts[1]}:${parts.slice(2).join('-')}`;
  }
  // Fallback: return as-is if it doesn't match expected pattern
  return localpart;
}

// ── Flow Engine Helpers ───────────────────────────────────────────────

/**
 * Creates a FlowRuntimeStateManager backed by a Y.Doc's 'runtime' map.
 * Mirrors the pattern from the editor's runtime.ts.
 * Wraps mutations in doc.transact for reliable CRDT sync.
 */
function createYDocRuntimeManager(doc: Y.Doc): FlowRuntimeStateManager {
  const map = doc.getMap('runtime');
  return {
    get: (nodeId: string): FlowNodeRuntimeState => {
      const stored = map.get(nodeId);
      if (!stored || typeof stored !== 'object') return {};
      return { ...(stored as FlowNodeRuntimeState) };
    },
    update: (nodeId: string, updates: Partial<FlowNodeRuntimeState>) => {
      doc.transact(() => {
        const current = map.get(nodeId);
        const existing =
          current && typeof current === 'object'
            ? { ...(current as FlowNodeRuntimeState) }
            : {};
        map.set(nodeId, { ...existing, ...updates });
      }, 'oracle-runtime-update');
    },
  };
}

/**
 * Oracle-side ActionServices — MVP supports HTTP only.
 * Additional services (email, notify) can be wired up when the oracle has those capabilities.
 */
const oracleActionServices: ActionServices = {
  http: {
    request: async (params: {
      url: string;
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
    }) => {
      const { url, method, headers = {}, body } = params;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const data = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = data;
      }
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      return { status: res.status, headers: responseHeaders, data: parsed };
    },
  },
};

/**
 * Creates BlockNote tools that use a shared Matrix client
 *
 * @param matrixClient - The singleton Matrix client (already synced)
 * @param config - Configuration for the provider and room
 * @param readOnly - If true, only returns read-only tools (list_blocks). Write tools are disabled but code is preserved.
 */
export const createBlocknoteTools = async (
  matrixClient: MatrixClient,
  config: AppConfig,
  readOnly: boolean = false,
) => {
  logger.log(
    `🔧 Creating BlockNote tools with Matrix client: ${matrixClient.getUserId()}`,
  );
  logger.log(`🔧 Target room: ${JSON.stringify(config.matrix.room)}`);

  let roomId: string;
  if (config.matrix.room.type === 'id') {
    roomId = config.matrix.room.value;
  } else {
    // Resolve room alias to room ID
    const ret = await matrixClient.getRoomIdForAlias(config.matrix.room.value);
    roomId = ret.room_id;
  }

  // ============================================================================
  // Tool 1: List Blocks
  // ============================================================================

  /**
   * Lists all blocks in the BlockNote document
   *
   * Returns detailed information about each block including:
   * - Block ID
   * - Block type (paragraph, proposal, checkbox, etc.)
   * - All attributes/properties
   * - Text content
   * - Nested structure
   */
  const listBlocksTool = tool(
    async ({ includeText = true, blockType = null }) => {
      logger.log('📋 list_blocks tool invoked');

      // Use the shared Matrix client (already synced)
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );

        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }
        // Get the document fragment
        const fragment = doc.getXmlFragment('document');

        // Collect all blocks using the working CLI logic
        const blocks = collectAllBlocks(fragment, includeText);

        // Filter by block type if specified
        const filteredBlocks = blockType
          ? blocks.filter((b) => b.blockType === blockType)
          : blocks;

        return JSON.stringify(
          {
            success: true,
            count: filteredBlocks.length,
            blocks: filteredBlocks,
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Schedule cleanup after delay to allow Y.Doc to finish syncing
        await providerManager.dispose();
      }
    },
    {
      name: 'list_blocks',
      description: `Lists all blocks in the BlockNote document with their complete structure and UUIDs.

**⚠️ CRITICAL: Always call this tool FIRST before any edit operation to get valid UUID block IDs.**

Use this tool to:
- Get exact UUIDs needed for editing (UUIDs are like: 550e8400-e29b-41d4-a716-446655440000)
- View all blocks in the document
- Filter blocks by type
- Check current block properties and state
- Understand document structure

**Parameter Examples:**

List all blocks with text:
\`\`\`json
{"includeText": true}
\`\`\`

List only proposal blocks:
\`\`\`json
{"includeText": true, "blockType": "proposal"}
\`\`\`

List blocks without text content (faster):
\`\`\`json
{"includeText": false}
\`\`\`

**Returns clean JSON like:**
\`\`\`json
{
  "success": true,
  "count": 3,
  "blocks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "proposal",
      "properties": {
        "status": "draft",
        "title": "My Proposal",
        "description": "Proposal details",
        "icon": "square-check"
      },
      "text": "Optional text content"
    }
  ]
}
\`\`\`

**Block types available:**
- paragraph: Simple text
- proposal: Blockchain proposals (status: draft/open/passed/rejected/executed/closed/execution_failed/veto_timelock)
- checkbox: Interactive checkboxes
- apiRequest: API calls (GET/POST/PUT/DELETE)
- list: Data lists
- domainCreator: Survey forms with surveySchema and answers (use read_survey, fill_survey_answers, validate_survey_answers tools)

**Note for domainCreator blocks:**
- surveySchema and answers are automatically parsed as structured JSON
- Use read_survey tool for detailed survey information
- Use fill_survey_answers to update answers
- Use validate_survey_answers to check completeness

**Important:** Block IDs are UUIDs - never guess them. Always extract exact IDs from this tool's response before calling edit_block.`,
      schema: z.object({
        includeText: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether to include text content in the response'),
        blockType: z
          .string()
          .optional()
          .nullable()
          .describe(
            'Optional: filter by block type (paragraph, proposal, checkbox, apiRequest, list, etc.)',
          ),
      }),
    },
  );

  // ============================================================================
  // Tool 2: Edit Block
  // ============================================================================

  /**
   * Edits an existing block's properties
   *
   * Uses the production-tested editBlock helper from blockActions.ts
   * which includes:
   * - Dual-storage pattern (attrs.props + direct attributes)
   * - Proper attribute merging
   * - Text update handling
   * - Consistent with CLI edit-block command
   *
   * Can update:
   * - Block attributes (status, title, description, etc.)
   * - Text content
   * - Remove specific attributes
   *
   * Changes are synced to all connected clients via Matrix CRDT
   */
  const editBlockTool = tool(
    async ({
      blockId,
      updates,
      removeAttributes = [],
      text = null,
      runtimeUpdates = undefined,
    }) => {
      Logger.log(`✏️ edit_block tool invoked for block: ${blockId}`);

      const isInRoom = await checkIfInRoomAndJoinPublicRoom(
        matrixClient,
        roomId,
      );

      if (!isInRoom) {
        return JSON.stringify({
          success: false,
          error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
        });
      }
      // Use the shared Matrix client (already synced)
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        // Guard: reject runtimeUpdates on action blocks in flow mode — use execute_action instead
        if (
          runtimeUpdates &&
          typeof runtimeUpdates === 'object' &&
          Object.keys(runtimeUpdates as Record<string, unknown>).length > 0
        ) {
          const blockDetail = getBlockDetail(doc, blockId, false);
          const blockProps = blockDetail
            ? extractBlockProperties(blockDetail)
            : {};
          const hasActionType = blockProps.actionType !== undefined;

          if (hasActionType) {
            const flowMeta = readFlowMetadata(doc);
            const isFlow = flowMeta['_type'] === 'ixo.flow.crdt';

            if (isFlow) {
              return JSON.stringify({
                success: false,
                error:
                  `Cannot apply runtimeUpdates directly to action block "${blockId}" in a flow document. ` +
                  `Use the execute_action tool instead — it runs the action through the flow engine ` +
                  `(activation → authorization → execution → runtime state update) for a proper audit trail.`,
              });
            }
          }
        }

        // Wrap updates in 'props' for consistency with CLI pattern
        const attributes =
          Object.keys(updates).length > 0 ? { props: updates } : {};

        // Use the production-tested editBlock helper
        const _snapshot: BlockSnapshot = editBlock(doc, {
          blockId,
          attributes,
          removeAttributes,
          text: text === null ? undefined : text,
          docName: 'document',
        });

        // Apply runtime state updates if provided
        let updatedRuntimeState: Record<string, unknown> | undefined;
        if (
          runtimeUpdates &&
          typeof runtimeUpdates === 'object' &&
          Object.keys(runtimeUpdates as Record<string, unknown>).length > 0
        ) {
          doc.transact(() => {
            updatedRuntimeState = updateRuntimeState(
              doc,
              blockId,
              runtimeUpdates as Record<string, unknown>,
            );
          }, 'blocknote-crdt-playground');
        }

        // Create simplified response for agents
        const updatedBlock = getBlockDetail(doc, blockId, true);
        // Changes are automatically synced by your Matrix provider
        return JSON.stringify({
          success: true,
          message: `Successfully updated block ${blockId}`,
          block: updatedBlock,
          ...(updatedRuntimeState && { runtimeState: updatedRuntimeState }),
        });
      } catch (error) {
        Logger.error('Error editing block:', error);
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Schedule cleanup after delay to allow Y.Doc to finish syncing
        await providerManager.dispose();
      }
    },
    {
      name: 'edit_block',
      description: `Edits an existing block's properties, content, and/or runtime state.

**CRITICAL WORKFLOW:**
1. Call list_blocks FIRST to get the exact UUID
2. Pass updates as plain key-value pairs (tool wraps them automatically)
3. Never guess or invent block IDs

**How Updates Work:**
- Pass properties as plain objects like \`{status: "open", title: "New Title"}\`
- Tool automatically wraps them in the internal \`props\` structure
- Use \`runtimeUpdates\` to update runtime state (execution status, timestamps, etc.) — merges with existing state, never overwrites
- Changes sync to all clients via CRDT

**JSON-string properties (inputs, links):**
- Some properties like \`inputs\` and \`links\` are stored as JSON strings internally
- When reading blocks, these are returned as parsed objects/arrays
- When updating, pass them as objects/arrays — they are auto-serialized back to JSON strings
- For \`inputs\` (object): your updates are MERGED with existing values. Example: \`{"inputs": {"credential": "abc"}}\` merges into existing inputs
- For \`links\` (array): your value REPLACES the existing array. Each link item needs: \`id\`, \`title\`, \`description\`, \`position\`. For external URLs add \`externalUrl\`. For internal flow links add \`docRoomId\`.

**Examples:**
- Update status: \`{"blockId": "uuid", "updates": {"status": "open"}}\`
- Update text: \`{"blockId": "uuid", "updates": {}, "text": "New content"}\`
- Update action inputs: \`{"blockId": "uuid", "updates": {"inputs": {"credential": "data", "roomId": "!room:server"}}}\`
- Update flowLink with external URL: \`{"blockId": "uuid", "updates": {"links": [{"id": "link-1", "title": "Verify Identity", "description": "Click to verify", "captionText": "", "position": 0, "externalUrl": "https://example.com/verify"}]}}\`
- Update runtime: \`{"blockId": "uuid", "updates": {}, "runtimeUpdates": {"evaluationStatus": "approved"}}\`
- Remove attrs: \`{"blockId": "uuid", "updates": {}, "removeAttributes": ["oldProp"]}\`

**Note:** Block properties vary by block type and may evolve. Use \`list_blocks\` or \`read_block_by_id\` to discover current properties for any block type.

**Returns:** Block details including id, type, properties, text, and runtimeState (if updated).

**Example response:**
\`\`\`json
{
  "success": true,
  "message": "Successfully updated block...",
  "block": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "proposal",
    "properties": {
      "status": "open",
      "title": "Updated Title",
      "description": "Updated description"
    },
    "text": "Optional text content"
  }
}
\`\`\``,
      schema: z.object({
        blockId: z
          .string()
          .describe('The exact ID of the block to edit (get from list_blocks)'),
        updates: z
          .record(z.any(), z.any())
          .describe(
            "Object with property updates. Example: {status: 'open', title: 'New Title'}",
          ),
        removeAttributes: z
          .array(z.string())
          .optional()
          .default([])
          .describe(
            "Array of attribute keys to remove. Example: ['oldProp', 'tempData']",
          ),
        text: z
          .string()
          .nullable()
          .optional()
          .describe(
            'New text content for the block. Use null to keep existing, empty string to clear',
          ),
        runtimeUpdates: z
          .record(z.any(), z.any())
          .optional()
          .describe(
            'Optional: merge updates into the block runtime state (execution status, claims, timestamps, etc.). Merges with existing state — never overwrites.',
          ),
      }),
    },
  );

  // ============================================================================
  // Tool 3: Create Block
  // ============================================================================

  /**
   * Creates a new block in the document using appendBlock from blockActions.ts.
   * Supports all block types — new blocks are appended to the end of the document.
   */
  const createBlockTool = tool(
    async ({ blockType, text = '', attributes = {}, blockId = null }) => {
      Logger.log(`➕ create_block tool invoked for type: ${blockType}`);
      // Use the shared Matrix client (already synced)
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );

        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        // Wrap attributes in 'props' for consistency with edit_block and BlockNote schema
        const wrappedAttributes =
          Object.keys(attributes).length > 0 ? { props: attributes } : {};

        // REUSE the same doc that was initialized at tool creation
        const snapshot = appendBlock(doc, {
          blockId: blockId ?? randomUUID(),
          blockType,
          text,
          attributes: wrappedAttributes,
          docName: 'document',
          namespace: undefined,
        });

        // Get simplified view for agents

        const createdBlock = getBlockDetail(doc, snapshot.id, true);
        const simplified = createdBlock
          ? simplifyBlockForAgent(createdBlock)
          : null;

        return JSON.stringify({
          success: true,
          message: `Successfully created ${blockType} block`,
          block: simplified || snapshot,
        });
      } catch (error) {
        Logger.error('Error creating block:', error);

        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Schedule cleanup after delay to allow Y.Doc to finish syncing
        await providerManager.dispose();
      }
    },
    {
      name: 'create_block',
      description: `Creates a new block in the BlockNote document.

**Usage:**
- Add new blocks to the document (appended at the end)
- Initialize blocks with specific properties as key-value pairs
- Block ID (UUID) is auto-generated unless you provide one
- Use \`read_block_by_id\` on existing blocks to discover available properties for any block type

**Examples:**
- Paragraph: \`{"blockType": "paragraph", "text": "Hello world"}\`
- Proposal: \`{"blockType": "proposal", "attributes": {"status": "draft", "title": "My Proposal"}}\`
- Checkbox: \`{"blockType": "checkbox", "attributes": {"checked": false, "title": "Task"}}\`

**Note:** Block attributes vary by type and may evolve. Use \`read_block_by_id\` on existing blocks to discover available properties. For survey-capable blocks (domainCreator, form, etc.), use the dedicated survey tools (read_survey, fill_survey_answers, validate_survey_answers).

**Returns:**
\`\`\`json
{
  "success": true,
  "message": "Successfully created proposal block",
  "block": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "proposal",
    "properties": {
      "status": "draft",
      "title": "New Proposal",
      "description": "Proposal description",
      "icon": "square-check"
    },
    "text": ""
  }
}
\`\`\`

The returned block includes the auto-generated UUID that you can use for future edits.`,
      schema: z.object({
        blockType: z
          .string()
          .describe(
            'Type of block to create: paragraph, proposal, checkbox, apiRequest, list, etc.',
          ),
        text: z
          .string()
          .optional()
          .default('')
          .describe('Text content for the block (mainly for paragraphs)'),
        attributes: z
          .record(z.any(), z.any())
          .optional()
          .default({})
          .describe(
            "Block-specific attributes as key-value pairs. Example: {status: 'draft', title: 'My Proposal'}",
          ),
        blockId: z
          .string()
          .optional()
          .nullable()
          .describe(
            'Optional: custom block ID. If not provided, one will be generated automatically',
          ),
      }),
    },
  );

  const readBlockByIdTool = tool(
    async ({
      blockId,
      evaluateConditions: evalConds = false,
      resolveReferences: resolveRefs = false,
    }) => {
      Logger.log(`📄 read_block_by_id tool invoked for block: ${blockId}`);
      const providerManager = new MatrixProviderManager(matrixClient, config);
      try {
        const { doc } = await providerManager.init();
        const block = getBlockDetail(doc, blockId, true);

        if (!block) {
          return JSON.stringify({ success: true, block: null });
        }

        const simplified = simplifyBlockForAgent(block);
        const result: Record<string, unknown> = {
          success: true,
          block: simplified,
        };

        // Include runtime state for this block if it exists
        const blockRuntimeState = readRuntimeState(doc, blockId);
        const runtimeData = blockRuntimeState[blockId];
        if (runtimeData && Object.keys(runtimeData).length > 0) {
          result.runtimeState = runtimeData;
        }

        // Optional: evaluate conditions
        if (evalConds) {
          const attrs = block.attributes || {};
          const attrsObj =
            (attrs.attrs as Record<string, unknown> | undefined) || {};
          const props =
            (attrsObj.props as Record<string, unknown> | undefined) || {};
          const conditionsJson =
            (props.conditions as string) || (attrs.conditions as string) || '';

          if (conditionsJson) {
            try {
              const conditionConfig = JSON.parse(
                conditionsJson,
              ) as ConditionConfig;
              const fragment = doc.getXmlFragment('document');
              const allBlocks = collectAllBlocks(fragment);
              result.conditionEvaluation = evaluateBlockConditions(
                conditionConfig,
                allBlocks,
              );
            } catch {
              result.conditionEvaluation = {
                error: 'Failed to parse conditions JSON',
              };
            }
          } else {
            result.conditionEvaluation = {
              isVisible: true,
              isEnabled: true,
              actions: [],
            };
          }
        }

        // Optional: resolve references in string props
        if (resolveRefs) {
          const fragment = doc.getXmlFragment('document');
          const allBlocks = collectAllBlocks(fragment);
          const resolvedProps: Record<string, unknown> = {};
          const blockProps = simplified.properties || {};

          for (const [key, val] of Object.entries(blockProps)) {
            if (
              typeof val === 'string' &&
              val.includes('{{') &&
              val.includes('}}')
            ) {
              resolvedProps[key] = resolveBlockReferences(val, allBlocks);
            }
          }

          if (Object.keys(resolvedProps).length > 0) {
            result.resolvedReferences = resolvedProps;
          }
        }

        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'read_block_by_id',
      description: `Reads a block by its ID. Returns block properties AND runtime state (execution status, claims, timestamps, etc.) in a single call.

Automatically includes runtimeState from Y.Map('runtime') when data exists for this block. Parses surveySchema and answers for survey blocks.

Optional flags:
- evaluateConditions: true → evaluates the block's condition config against all blocks, returns { isVisible, isEnabled, conditionActions[] }
- resolveReferences: true → resolves {{blockId.prop}} patterns in block props, returns resolved values`,
      schema: z.object({
        blockId: z.string().describe('The ID of the block to read'),
        evaluateConditions: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'If true, evaluates the block conditions and returns visibility/enabled state',
          ),
        resolveReferences: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'If true, resolves {{blockId.prop}} template references in block props',
          ),
      }),
    },
  );

  // ============================================================================
  // Tool 5: Read Survey
  // ============================================================================

  const readSurveyTool = tool(
    async ({ blockId }) => {
      Logger.log(`📋 read_survey tool invoked for block: ${blockId}`);
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );

        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const block = getBlockDetail(doc, blockId, true);
        console.log('🚀 ~ createBlocknoteTools ~ block:', block);
        if (!block) {
          return JSON.stringify({
            success: false,
            error: `Block with id ${blockId} not found`,
          });
        }

        const properties = extractBlockProperties(block);
        const surveySchema = properties.surveySchema as
          | SurveySchema
          | undefined;
        const answers = (properties.answers || {}) as Record<string, unknown>;

        if (!surveySchema) {
          Logger.error('Block does not contain a surveySchema:', block);
          return JSON.stringify({
            success: false,
            error: `Block ${blockId} does not contain a surveySchema property. This tool works with any block that has a surveySchema (domainCreator, form, governanceGroup, bid, claim, etc.)`,
          });
        }

        // Extract all questions with visibility computed inline
        const allQuestions = await extractSurveyQuestions(
          surveySchema,
          answers,
        );

        const missingRequired = await getMissingRequiredFields(
          answers,
          surveySchema,
        );

        return JSON.stringify(
          {
            success: true,
            survey: {
              title: surveySchema.title,
              description: surveySchema.description,
            },
            questions: allQuestions,
            answers,
            missingRequiredFields: missingRequired,
            totalQuestions: allQuestions.length,
          },
          null,
          2,
        );
      } catch (error) {
        Logger.error('Error reading survey:', error);
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'read_survey',
      description: `Reads survey schema and current answers from any block with a surveySchema property.

**Purpose:**
- View complete survey structure (ALL questions including hidden ones)
- See current answers as structured JSON
- Identify which questions are currently visible vs hidden
- Understand why fields are hidden (via visibleIf conditions)
- Find missing required fields (only for visible questions)
- Automatically fetches choices from choicesByUrl for dropdown questions
- Works with any block type that has a surveySchema (domainCreator, form, governanceGroup, bid, claim, etc.)

**Important:**
- ALL questions are returned (both visible and hidden), not just visible ones
- \`isVisible: true\` means the field is currently shown in the UI
- \`isVisible: false\` means the field is hidden by a \`visibleIf\` condition
- \`visibleIf\` field shows the condition that controls visibility
- Hidden fields can be made visible by changing the controlling answer
- Nested dynamic panel template elements are included in the questions array
- Choices from choicesByUrl are automatically fetched and included

**Note:** The \`answers\` object may contain data for hidden fields — use the \`questions\` array to understand the schema for those fields.`,
      schema: z.object({
        blockId: z
          .string()
          .describe('The ID of the block containing the survey'),
      }),
    },
  );

  // ============================================================================
  // Tool 6: Fill Survey Answers
  // ============================================================================

  const fillSurveyAnswersTool = tool(
    async ({ blockId, answers, merge = true }) => {
      Logger.log(`✏️ fill_survey_answers tool invoked for block: ${blockId}`);
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );

        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const block = getBlockDetail(doc, blockId, true);
        if (!block) {
          return JSON.stringify({
            success: false,
            error: `Block with id ${blockId} not found`,
          });
        }

        const properties = extractBlockProperties(block);
        const surveySchema = properties.surveySchema as
          | SurveySchema
          | undefined;

        if (!surveySchema) {
          return JSON.stringify({
            success: false,
            error: `Block ${blockId} does not contain a surveySchema property. This tool works with any block that has a surveySchema (domainCreator, form, governanceGroup, bid, claim, etc.)`,
          });
        }

        // Get current answers
        const currentAnswers = (properties.answers || {}) as Record<
          string,
          unknown
        >;

        // Merge or replace answers
        const updatedAnswers = merge
          ? { ...currentAnswers, ...answers }
          : answers;

        // Validate the updated answers
        const validation = await validateAnswersAgainstSchema(
          updatedAnswers,
          surveySchema,
        );

        // Update the block's answers attribute
        const fragment = doc.getXmlFragment('document');
        const blockContainer = findBlockById(fragment, blockId);

        if (!blockContainer) {
          return JSON.stringify({
            success: false,
            error: `Block container not found`,
          });
        }

        // Use Y.js transaction to update the answers
        doc.transact(() => {
          // Find the content child element that has an answers attribute
          const contentElement = blockContainer
            .toArray()
            .find(
              (node): node is Y.XmlElement =>
                node instanceof Y.XmlElement &&
                node.nodeName !== 'blockGroup' &&
                node.nodeName !== 'blockContainer',
            );

          if (contentElement) {
            // Update the answers attribute as JSON string directly on the child element
            contentElement.setAttribute(
              'answers',
              JSON.stringify(updatedAnswers),
            );
          } else {
            logger.error(
              'Content element not found, falling back to edit_block helper',
            );
            // Fallback: use edit_block helper which handles the structure properly
            editBlock(doc, {
              blockId,
              attributes: {
                props: { answers: JSON.stringify(updatedAnswers) },
              },
              docName: 'document',
            });
          }
        }, 'blocknote-crdt-playground');

        return JSON.stringify(
          {
            success: true,
            message: `Successfully ${merge ? 'merged' : 'replaced'} survey answers`,
            answers: updatedAnswers,
            validation,
            missingRequiredFields: await getMissingRequiredFields(
              updatedAnswers,
              surveySchema,
            ),
          },
          null,
          2,
        );
      } catch (error) {
        Logger.error('Error filling survey answers:', error);
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'fill_survey_answers',
      description: `Fills in survey answers for any block with a surveySchema. Intelligently merges with existing answers and validates against schema.

**Purpose:**
- Fill in partial or complete survey answers
- Merge with existing answers (default) or replace them
- Automatically validates answers against schema
- Respects visibility conditions
- Works with any block type that has a surveySchema (domainCreator, form, governanceGroup, bid, claim, etc.)

**Example 1 - Fill single answer:**
\`\`\`json
{
  "blockId": "271fc5de-bcd8-4de0-8dd7-fb3dd5c13785",
  "answers": {
    "schema:name": "My New Domain",
    "schema.description": "A description of my domain"
  },
  "merge": true
}
\`\`\`

**Example 2 - Replace all answers:**
\`\`\`json
{
  "blockId": "271fc5de-bcd8-4de0-8dd7-fb3dd5c13785",
  "answers": {
    "schema:name": "New Domain",
    "type_2": "dao",
    "schema:validFrom": "2025-01-01"
  },
  "merge": false
}
\`\`\`

**Note:**
- Use merge=true (default) to keep existing answers and only update specified fields
- Use merge=false to replace all answers
- Answers are validated automatically
- Only visible questions (based on visibility conditions) are considered`,
      schema: z.object({
        blockId: z
          .string()
          .describe('The ID of the block containing the survey'),
        answers: z
          .record(z.any(), z.any())
          .describe(
            'Object with answer key-value pairs. Keys should match question names from the schema.',
          ),
        merge: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'If true, merge with existing answers. If false, replace all answers.',
          ),
      }),
    },
  );

  // ============================================================================
  // Tool 7: Validate Survey Answers
  // ============================================================================

  const validateSurveyAnswersTool = tool(
    async ({ blockId }) => {
      Logger.log(
        `✅ validate_survey_answers tool invoked for block: ${blockId}`,
      );
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );

        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const block = getBlockDetail(doc, blockId, true);
        if (!block) {
          return JSON.stringify({
            success: false,
            error: `Block with id ${blockId} not found`,
          });
        }

        const properties = extractBlockProperties(block);
        const surveySchema = properties.surveySchema as
          | SurveySchema
          | undefined;
        const answers = (properties.answers || {}) as Record<string, unknown>;

        if (!surveySchema) {
          return JSON.stringify({
            success: false,
            error: `Block ${blockId} does not contain a surveySchema property. This tool works with any block that has a surveySchema (domainCreator, form, governanceGroup, bid, claim, etc.)`,
          });
        }

        const validation = await validateAnswersAgainstSchema(
          answers,
          surveySchema,
        );
        const missingRequired = await getMissingRequiredFields(
          answers,
          surveySchema,
        );
        const visibleQuestions = await getVisibleQuestions(
          answers,
          surveySchema,
        );

        return JSON.stringify(
          {
            success: true,
            valid: validation.valid,
            errors: validation.errors,
            warnings: validation.warnings,
            missingRequiredFields: missingRequired,
            answeredQuestions: Object.keys(answers).length,
            visibleQuestionsCount: visibleQuestions.length,
            totalRequiredFields: visibleQuestions.filter((q) => q.isRequired)
              .length,
            completionPercentage:
              visibleQuestions.length > 0
                ? Math.round(
                    ((visibleQuestions.length - missingRequired.length) /
                      visibleQuestions.length) *
                      100,
                  )
                : 0,
          },
          null,
          2,
        );
      } catch (error) {
        Logger.error('Error validating survey answers:', error);
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'validate_survey_answers',
      description: `Validates current survey answers against the schema requirements. Works with any block that has a surveySchema.

**Purpose:**
- Check if all required fields are filled
- Validate answer types and formats
- Identify validation errors and warnings
- Calculate completion percentage
- Works with any block type that has a surveySchema (domainCreator, form, governanceGroup, bid, claim, etc.)

**Validation Types:**
- required: Field is required but missing or empty
- type: Answer type doesn't match expected type (e.g., boolean vs string)
- choice: Answer value not in allowed choices (for dropdowns)
- format: Answer format is invalid (e.g., invalid email or URL)

**Note:** Only validates visible questions based on current answers and visibility conditions.`,
      schema: z.object({
        blockId: z
          .string()
          .describe('The ID of the block to validate survey answers for'),
      }),
    },
  );

  // ============================================================================
  // Tool 8: Read Flow Context
  // ============================================================================

  const readFlowContextTool = tool(
    async () => {
      logger.log('📊 read_flow_context tool invoked');
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );
        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const flowMetadata = readFlowMetadata(doc);
        const fragment = doc.getXmlFragment('document');
        const blocks = collectAllBlocks(fragment);
        const flowNodes = readFlowNodes(doc);
        const runtimeMap = doc.getMap('runtime');
        const delegationsMap = doc.getMap('delegations');

        return JSON.stringify(
          {
            success: true,
            flowMetadata,
            summary: {
              blockCount: blocks.length,
              flowNodeCount: flowNodes.length,
              isFlowDocument: flowMetadata['_type'] === 'ixo.flow.crdt',
              hasRuntimeState: runtimeMap.size > 0,
              hasDelegations: delegationsMap.size > 1,
            },
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'read_flow_context',
      description: `Reads flow-level metadata and document context. **Call this FIRST** in any new conversation to understand what document you're working with.

Returns: flow metadata (title, owner DID, doc type, schema version, creation date), block count, flow node count, and whether runtime state/delegations exist.

This is a lightweight call that gives you the full picture before diving into specific blocks.`,
      schema: z.object({}),
    },
  );

  // ============================================================================
  // Tool 9: Read Flow Status
  // ============================================================================

  const readFlowStatusTool = tool(
    async ({ nodeId = null }) => {
      logger.log(
        `📈 read_flow_status tool invoked${nodeId ? ` for node: ${nodeId}` : ''}`,
      );
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );
        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const flowNodes = readFlowNodes(doc);
        const runtimeState = readRuntimeState(doc, nodeId ?? undefined);

        // Enrich runtime state with human-readable dates
        const enrichedState: Record<string, Record<string, unknown>> = {};
        for (const [id, state] of Object.entries(runtimeState)) {
          const enriched: Record<string, unknown> = { ...state };
          const ts = state['executionTimestamp'];
          if (typeof ts === 'number') {
            enriched['executionDate'] = new Date(ts).toISOString();
          }
          enrichedState[id] = enriched;
        }

        // Build summary — graceful field checks for generic data
        const allRuntimeState = readRuntimeState(doc);
        const stateValues = Object.values(allRuntimeState);
        const executedNodes = stateValues.filter(
          (s) => s['executionTimestamp'],
        ).length;

        return JSON.stringify(
          {
            success: true,
            flowNodes,
            runtimeState: enrichedState,
            summary: {
              totalNodes: flowNodes.length,
              executedNodes,
              pendingNodes: stateValues.filter(
                (s) => s['evaluationStatus'] === 'pending',
              ).length,
              approvedNodes: stateValues.filter(
                (s) => s['evaluationStatus'] === 'approved',
              ).length,
              rejectedNodes: stateValues.filter(
                (s) => s['evaluationStatus'] === 'rejected',
              ).length,
            },
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'read_flow_status',
      description: `Reads the execution status of flow nodes. Shows which blocks have been executed, by whom, when, and their evaluation status (pending/approved/rejected).

Use this to answer: "What's the status of this flow?", "Which steps are done?", "Who executed block X?"

Pass nodeId to check a specific node, or omit to get all nodes.`,
      schema: z.object({
        nodeId: z
          .string()
          .optional()
          .nullable()
          .describe('Optional: specific node ID to check. Omit for all nodes.'),
      }),
    },
  );

  // ============================================================================
  // Tool 10: Read Block History
  // ============================================================================

  const readBlockHistoryTool = tool(
    async ({ blockId }) => {
      logger.log(`📜 read_block_history tool invoked for block: ${blockId}`);
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );
        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const auditEvents = readAuditTrailForBlock(doc, blockId);
        const invocations = readInvocations(doc, blockId);

        const successfulInvocations = invocations.filter(
          (i) => i['result'] === 'success',
        ).length;
        const failedInvocations = invocations.filter(
          (i) => i['result'] === 'failure',
        ).length;

        // Enrich invocations with human-readable dates
        const enrichedInvocations = invocations.map((inv) => {
          const enriched: Record<string, unknown> = { ...inv };
          const executedAt = inv['executedAt'];
          if (typeof executedAt === 'number') {
            enriched['executedDate'] = new Date(executedAt).toISOString();
          } else if (typeof executedAt === 'string') {
            enriched['executedDate'] = new Date(executedAt).toISOString();
          }
          return enriched;
        });

        // Find most recent activity
        const lastAuditEvent =
          auditEvents.length > 0
            ? auditEvents[auditEvents.length - 1]
            : undefined;
        const lastAuditMeta =
          lastAuditEvent &&
          typeof lastAuditEvent['meta'] === 'object' &&
          lastAuditEvent['meta'] !== null
            ? (lastAuditEvent['meta'] as Record<string, unknown>)
            : undefined;
        const lastAuditTs = lastAuditMeta?.['timestamp'] as string | undefined;
        const firstInv =
          enrichedInvocations.length > 0 ? enrichedInvocations[0] : undefined;
        const lastInvTs = firstInv?.['executedDate'] as string | undefined;
        const lastActivity =
          lastAuditTs && lastInvTs
            ? lastAuditTs > lastInvTs
              ? lastAuditTs
              : lastInvTs
            : lastAuditTs || lastInvTs;

        return JSON.stringify(
          {
            success: true,
            blockId,
            auditEvents,
            invocations: enrichedInvocations,
            summary: {
              totalAuditEvents: auditEvents.length,
              totalInvocations: invocations.length,
              successfulInvocations,
              failedInvocations,
              lastActivity,
            },
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'read_block_history',
      description: `Reads the complete history for a specific block: audit trail events and UCAN invocations.

Use this to answer: "What happened with block X?", "Who executed this?", "When was this last updated?"

Returns audit events (timestamped actions) and invocations (UCAN-authorized executions with results and transaction hashes).`,
      schema: z.object({
        blockId: z.string().describe('The block ID to read history for'),
      }),
    },
  );

  // ============================================================================
  // Tool 11: Read Permissions
  // ============================================================================

  const readPermissionsTool = tool(
    async ({ audienceDid = null, capability = null }) => {
      logger.log('🔐 read_permissions tool invoked');
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );
        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const { rootCid, delegations } = readDelegations(doc);

        // Apply filters using bracket notation on generic records
        let filtered = delegations;
        if (audienceDid) {
          filtered = filtered.filter((d) => d['audienceDid'] === audienceDid);
        }
        if (capability) {
          filtered = filtered.filter((d) => {
            const caps = d['capabilities'];
            if (!Array.isArray(caps)) return false;
            return caps.some(
              (c: Record<string, unknown>) =>
                c['can'] === capability ||
                (typeof c['can'] === 'string' &&
                  c['can'].endsWith('/*') &&
                  capability.startsWith(c['can'].slice(0, -2))),
            );
          });
        }

        const now = Date.now();
        const enriched = filtered.map((d) => {
          const expiration = d['expiration'];
          const enrichedDelegation: Record<string, unknown> = { ...d };
          if (typeof expiration === 'number') {
            enrichedDelegation['expirationDate'] = new Date(
              expiration,
            ).toISOString();
            enrichedDelegation['isExpired'] = expiration < now;
          } else {
            enrichedDelegation['isExpired'] = false;
          }
          return enrichedDelegation;
        });

        const activeDelegations = enriched.filter((d) => !d['isExpired']);
        const uniqueActors = [
          ...new Set(
            filtered
              .map((d) => d['audienceDid'])
              .filter((v): v is string => typeof v === 'string'),
          ),
        ];

        return JSON.stringify(
          {
            success: true,
            rootDelegationCid: rootCid,
            delegations: enriched,
            summary: {
              totalDelegations: enriched.length,
              activeDelegations: activeDelegations.length,
              expiredDelegations: enriched.length - activeDelegations.length,
              uniqueActors,
            },
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'read_permissions',
      description: `Reads the UCAN delegation chain — who has permission to do what in this flow.

Use this to answer: "Who can execute block X?", "What permissions does user Y have?", "Show me the delegation chain."

Optionally filter by audienceDid (recipient) or capability action (e.g., "flow/block/execute"). Supports wildcard matching (e.g., "flow/*" covers "flow/block/execute").`,
      schema: z.object({
        audienceDid: z
          .string()
          .optional()
          .nullable()
          .describe('Optional: filter by recipient DID'),
        capability: z
          .string()
          .optional()
          .nullable()
          .describe(
            'Optional: filter by capability action, e.g. "flow/block/execute"',
          ),
      }),
    },
  );

  // ============================================================================
  // Tool 12: Delete Block
  // ============================================================================

  const deleteBlockTool = tool(
    async ({ blockId, confirm }) => {
      logger.log(`🗑️ delete_block tool invoked for block: ${blockId}`);

      if (!confirm) {
        return JSON.stringify({
          success: false,
          error:
            'Deletion requires confirm: true. Set confirm to true to proceed with deletion.',
        });
      }

      const isInRoom = await checkIfInRoomAndJoinPublicRoom(
        matrixClient,
        roomId,
      );
      if (!isInRoom) {
        return JSON.stringify({
          success: false,
          error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
        });
      }

      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const deleted = deleteBlock(doc, {
          blockId,
          docName: 'document',
        });

        if (!deleted) {
          return JSON.stringify({
            success: false,
            error: `Block with id ${blockId} not found`,
          });
        }

        return JSON.stringify({
          success: true,
          message: `Successfully deleted block ${blockId}`,
          deletedBlockId: blockId,
        });
      } catch (error) {
        Logger.error('Error deleting block:', error);
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'delete_block',
      description: `Removes a block from the document. Requires confirm: true as a safety check.

**CRITICAL:** Always call list_blocks first to verify the block ID. This action cannot be undone.`,
      schema: z.object({
        blockId: z
          .string()
          .describe(
            'The exact UUID of the block to delete (get from list_blocks)',
          ),
        confirm: z
          .boolean()
          .describe(
            'Must be true to confirm deletion. Safety check to prevent accidental deletions.',
          ),
      }),
    },
  );

  // ============================================================================
  // Tool 13: Search Blocks
  // ============================================================================

  const searchBlocksTool = tool(
    async ({
      blockType = null,
      propKey = null,
      propValue = null,
      textContains = null,
    }) => {
      logger.log('🔍 search_blocks tool invoked');
      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        const isInRoom = await checkIfInRoomAndJoinPublicRoom(
          matrixClient,
          roomId,
        );
        if (!isInRoom) {
          return JSON.stringify({
            success: false,
            error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
          });
        }

        const fragment = doc.getXmlFragment('document');
        let blocks = collectAllBlocks(fragment);

        // Apply filters (AND logic)
        if (blockType) {
          blocks = blocks.filter((b) => {
            const simplified = simplifyBlockForAgent(b);
            return simplified.type === blockType;
          });
        }

        if (propKey && propValue !== null) {
          blocks = blocks.filter((b) => {
            const props = extractBlockProperties(b);
            return String(props[propKey]) === String(propValue);
          });
        }

        if (textContains) {
          const searchLower = textContains.toLowerCase();
          blocks = blocks.filter(
            (b) => b.text && b.text.toLowerCase().includes(searchLower),
          );
        }

        const simplified = blocks.map(simplifyBlockForAgent);

        return JSON.stringify(
          {
            success: true,
            count: simplified.length,
            blocks: simplified,
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'search_blocks',
      description: `Search blocks by type, property value, or text content. Filters combine with AND logic.

Examples:
- Find all proposals: {"blockType": "proposal"}
- Find executed blocks: {"propKey": "status", "propValue": "executed"}
- Find blocks mentioning "KYC": {"textContains": "KYC"}
- Combine: {"blockType": "checkbox", "propKey": "checked", "propValue": "true"}`,
      schema: z.object({
        blockType: z
          .string()
          .optional()
          .nullable()
          .describe('Filter by block type (proposal, checkbox, form, etc.)'),
        propKey: z
          .string()
          .optional()
          .nullable()
          .describe('Property key to search on (e.g., "status", "title")'),
        propValue: z
          .string()
          .optional()
          .nullable()
          .describe('Property value to match (exact string match)'),
        textContains: z
          .string()
          .optional()
          .nullable()
          .describe(
            'Search text content of blocks (case-insensitive substring match)',
          ),
      }),
    },
  );

  // ============================================================================
  // Tool 14: Execute Action (flow engine integration)
  // ============================================================================

  /**
   * Executes an action block through the flow engine pipeline:
   * activation → authorization → execution → runtime state update.
   *
   * Supports: http.request, email.send, notification.push,
   * human.checkbox.set, form.submit, protocol.select
   */
  const executeActionTool = tool(
    async ({ blockId, inputOverrides = {} }) => {
      Logger.log(`⚡ execute_action tool invoked for block: ${blockId}`);

      const isInRoom = await checkIfInRoomAndJoinPublicRoom(
        matrixClient,
        roomId,
      );

      if (!isInRoom) {
        return JSON.stringify({
          success: false,
          error: `Companion is not in the room ${roomId}, please invite companion to the room. companion user id: ${matrixClient.getUserId()}`,
        });
      }

      const providerManager = new MatrixProviderManager(matrixClient, config);

      try {
        const { doc } = await providerManager.init();

        // 1. Verify this is a flow document (not a template)
        const flowMeta = readFlowMetadata(doc);
        if (flowMeta['_type'] !== 'ixo.flow.crdt') {
          return JSON.stringify({
            success: false,
            error:
              'execute_action is only supported on flow documents, not templates.',
          });
        }

        // 2. Read the block and extract actionType
        const blockDetail = getBlockDetail(doc, blockId, false);
        if (!blockDetail) {
          return JSON.stringify({
            success: false,
            error: `Block "${blockId}" not found.`,
          });
        }

        const blockProps = extractBlockProperties(blockDetail);
        const actionType = blockProps.actionType as string | undefined;
        if (!actionType) {
          return JSON.stringify({
            success: false,
            error: `Block "${blockId}" is not an action block (no actionType property).`,
          });
        }

        // 3. Look up registered action
        const actionDef = getAction(actionType);
        if (!actionDef) {
          const available = getAllActions().map((a) => a.type);
          return JSON.stringify({
            success: false,
            error: `Unknown action type "${actionType}". Available: ${available.join(', ')}`,
          });
        }

        // 4. Parse inputs from block props and merge with overrides
        let inputs: Record<string, unknown> = {};
        if (blockProps.inputs) {
          try {
            inputs =
              typeof blockProps.inputs === 'string'
                ? JSON.parse(blockProps.inputs)
                : (blockProps.inputs as Record<string, unknown>);
          } catch {
            inputs = {};
          }
        }
        if (inputOverrides && Object.keys(inputOverrides).length > 0) {
          inputs = { ...inputs, ...inputOverrides };
        }

        // 5. Resolve {{blockId.prop}} references in input values
        const allBlocks = collectAllBlocks(doc.getXmlFragment('document'));
        for (const [key, val] of Object.entries(inputs)) {
          if (
            typeof val === 'string' &&
            val.includes('{{') &&
            val.includes('}}')
          ) {
            inputs[key] = resolveBlockReferences(val, allBlocks);
          }
        }

        // 6. Build FlowNode from block
        const flowNode = buildFlowNodeFromBlock({
          id: blockId,
          type: blockDetail.blockType || 'action',
          props: blockProps,
        });

        // 7. Build runtime state manager from Y.Doc
        const runtimeManager = createYDocRuntimeManager(doc);

        // 8. Derive oracle DID from Matrix user ID
        // Matrix format: @did-ixo-ixo1abc123:mx.server.com → did:ixo:ixo1abc123
        const oracleUserId =
          configService.get('MATRIX_ORACLE_ADMIN_USER_ID') ?? '';
        const actorDid = matrixUserIdToDid(oracleUserId);

        const flowId = (flowMeta.doc_id as string) ?? roomId;

        // 9. Execute through the flow engine (V1 — no UCAN invocation for MVP)
        // executeNode handles: activation check → authorization check → action() → runtime update
        const outcome = await executeNode({
          node: flowNode,
          actorDid,
          context: {
            runtime: runtimeManager,
          },
          action: async () => {
            const result = await actionDef.run(inputs, {
              actorDid,
              flowId,
              nodeId: blockId,
              services: oracleActionServices,
            });
            return { payload: result.output };
          },
        });

        // Supplement runtime with V1 lifecycle fields + action output
        // (executeNode's updateRuntimeAfterSuccess only writes legacy compat fields)
        if (outcome.success && outcome.result) {
          runtimeManager.update(blockId, {
            state: 'completed',
            output: outcome.result.payload as Record<string, unknown>,
            executedByDid: actorDid,
            executedAt: Date.now(),
          });
        } else if (!outcome.success) {
          runtimeManager.update(blockId, {
            state: 'failed',
            error: {
              message: outcome.error ?? 'Unknown error',
              at: Date.now(),
            },
          });
        }

        return JSON.stringify({
          success: outcome.success,
          stage: outcome.stage,
          ...(outcome.error && { error: outcome.error }),
          ...(outcome.result && { result: outcome.result }),
          blockId,
          actionType,
        });
      } catch (error) {
        Logger.error('Error executing action:', error);
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'execute_action',
      description: `Executes an action block through the flow engine pipeline.

**Flow engine gates:** activation → authorization → execution → runtime state update

**Supported actions:** http.request, email.send, notification.push, human.checkbox.set, form.submit, protocol.select

**Usage:**
- Pass the blockId of an action block (a block with an \`actionType\` property)
- Optionally provide inputOverrides to override/supplement the block's stored inputs
- The tool resolves \`{{blockId.prop}}\` references in inputs automatically
- Returns the execution outcome including success/failure, stage reached, and result data

**Example:**
\`\`\`json
{"blockId": "550e8400-e29b-41d4-a716-446655440000"}
\`\`\`

**With input overrides:**
\`\`\`json
{"blockId": "550e8400-e29b-41d4-a716-446655440000", "inputOverrides": {"url": "https://api.example.com/data"}}
\`\`\`

**Returns:**
\`\`\`json
{
  "success": true,
  "stage": "execution",
  "result": {"status": 200, "data": {...}},
  "blockId": "...",
  "actionType": "http.request"
}
\`\`\``,
      schema: z.object({
        blockId: z
          .string()
          .describe(
            'The exact ID of the action block to execute (must have actionType property)',
          ),
        inputOverrides: z
          .record(z.any(), z.any())
          .optional()
          .default({})
          .describe(
            'Optional: override or supplement the block\'s stored inputs. Example: {"url": "https://..."}',
          ),
      }),
    },
  );

  // ============================================================================
  // Return tools based on mode
  // ============================================================================

  if (readOnly) {
    return {
      listBlocksTool,
      readBlockByIdTool,
      searchBlocksTool,
      readFlowContextTool,
      readFlowStatusTool,
      readBlockHistoryTool,
      readPermissionsTool,
      readSurveyTool,
      validateSurveyAnswersTool,
    };
  }

  return {
    listBlocksTool,
    editBlockTool,
    createBlockTool,
    deleteBlockTool,
    readBlockByIdTool,
    searchBlocksTool,
    readFlowContextTool,
    readFlowStatusTool,
    readBlockHistoryTool,
    readPermissionsTool,
    readSurveyTool,
    fillSurveyAnswersTool,
    validateSurveyAnswersTool,
    executeActionTool,
  };
};

const checkIfInRoomAndJoinPublicRoom = async (
  matrixClient: MatrixClient,
  roomId: string,
) => {
  const joinRuleEvent = await matrixClient.getStateEvent(
    roomId,
    'm.room.join_rules',
    '',
  );
  const joinRule = joinRuleEvent.join_rule;
  const isPublicRoom = joinRule === 'public';
  const isInRoom =
    matrixClient.getRoom(roomId)?.getMember(matrixClient.getUserId() ?? '')
      ?.membership === 'join';
  if (!isPublicRoom && !isInRoom) {
    await matrixClient.joinRoom(roomId);
    Logger.log(`Joined room ${roomId}`);
  }
  return isInRoom;
};
