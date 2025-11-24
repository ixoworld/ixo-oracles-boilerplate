/**
 * LangChain Tools for BlockNote Y.js Editing
 */

import { tool } from '@langchain/core/tools';
import * as z from 'zod';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MatrixClient } from 'matrix-js-sdk';
import { randomUUID } from 'node:crypto';
import { ENV } from 'src/config';
import {
  appendBlock,
  collectAllBlocks,
  editBlock,
  getBlockDetail,
  simplifyBlockForAgent,
  type BlockSnapshot,
} from './blocknote-helper';
import { AppConfig, MatrixProviderManager } from './provider';

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

        const simplifiedBlocks = filteredBlocks.map(simplifyBlockForAgent);

        return JSON.stringify(
          {
            success: true,
            count: simplifiedBlocks.length,
            blocks: simplifiedBlocks,
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
    async ({ blockId, updates, removeAttributes = [], text = null }) => {
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
        // Wrap updates in 'props' for consistency with CLI pattern
        const attributes =
          Object.keys(updates).length > 0 ? { props: updates } : {};

        // Use the production-tested editBlock helper
        const snapshot: BlockSnapshot = editBlock(doc, {
          blockId,
          attributes,
          removeAttributes,
          text: text === null ? undefined : text,
          docName: 'document',
        });

        // Wait for sync
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Create simplified response for agents
        const {
          getBlockDetail,
          simplifyBlockForAgent,
        } = require('./blocknote-helper');
        const updatedBlock = getBlockDetail(doc, blockId, true);
        const simplified = updatedBlock
          ? simplifyBlockForAgent(updatedBlock)
          : null;

        // Changes are automatically synced by your Matrix provider
        return JSON.stringify({
          success: true,
          message: `Successfully updated block ${blockId}`,
          block: simplified || snapshot,
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
      description: `Edits an existing block's properties and content.

**⚠️ CRITICAL WORKFLOW:**
1. Call list_blocks FIRST to get the exact UUID
2. Extract UUID from results (UUIDs are like: 550e8400-e29b-41d4-a716-446655440000)
3. Pass updates as plain key-value pairs (tool wraps them automatically)
4. Never guess or invent block IDs

**How Updates Work:**
- Pass properties as plain objects like \`{status: "open", title: "New Title"}\`
- Tool automatically wraps them in the internal \`props\` structure
- Changes sync to all clients via CRDT

**Example 1 - Update proposal status:**
\`\`\`json
{
  "blockId": "550e8400-e29b-41d4-a716-446655440000",
  "updates": {
    "status": "open",
    "title": "Updated Proposal Title"
  }
}
\`\`\`

**Example 2 - Update paragraph text:**
\`\`\`json
{
  "blockId": "abc-123-def-456",
  "updates": {},
  "text": "New paragraph content here"
}
\`\`\`

**Example 3 - Update checkbox state:**
\`\`\`json
{
  "blockId": "checkbox-uuid-here",
  "updates": {
    "checked": true,
    "title": "Task completed"
  }
}
\`\`\`

**Example 4 - Remove attributes:**
\`\`\`json
{
  "blockId": "some-uuid",
  "updates": {},
  "removeAttributes": ["oldProperty", "tempData"]
}
\`\`\`

**Example 5 - Update API request:**
\`\`\`json
{
  "blockId": "api-block-uuid",
  "updates": {
    "status": "success",
    "response": "{\\"data\\": \\"result\\"}"
  }
}
\`\`\`

**Complete Property Reference by Block Type:**

**proposal** - Blockchain proposals
  - status: "draft" | "open" | "passed" | "rejected" | "executed" | "closed" | "execution_failed" | "veto_timelock"
  - title: string
  - description: string
  - proposalId: string
  - actions: string (JSON array)
  - voteEnabled: boolean
  - voteTitle: string
  - voteSubtitle: string
  - voteIcon: string
  - daysLeft: number
  - proposalContractAddress: string
  - coreAddress: string
  - conditions: string (JSON)

**checkbox** - Interactive checkboxes
  - checked: boolean
  - title: string
  - description: string
  - icon: string
  - allowedCheckers: "all" | "specific" | string array
  - initialChecked: boolean
  - conditions: string (JSON)

**apiRequest** - API call blocks
  - endpoint: string
  - method: "GET" | "POST" | "PUT" | "DELETE"
  - headers: string (JSON array of key-value pairs)
  - body: string (JSON array of key-value pairs)
  - response: string
  - status: "idle" | "loading" | "success" | "error"
  - title: string
  - description: string
  - conditions: string (JSON)

**list** - Data list blocks
  - title: string
  - did: string (Decentralized Identifier)
  - fragmentIdentifier: string
  - conditions: string (JSON)

**paragraph** - Text blocks
  - No special properties (use 'text' parameter to update content)

**Returns:**
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
      }),
    },
  );

  // ============================================================================
  // Tool 3: Create Block
  // ============================================================================

  /**
   * Creates a new block in the document
   *
   * Uses the production-tested appendBlock helper from blockActions.ts
   * which includes:
   * - Dual-storage pattern (attrs + direct attributes)
   * - Proper block structure creation
   * - Consistent with CLI add-block command
   *
   * Supports all block types:
   * - paragraph: Simple text blocks
   * - proposal: Blockchain proposals
   * - checkbox: Interactive checkboxes
   * - apiRequest: API call blocks
   * - list: Data list blocks
   *
   * New blocks are appended to the end of the document
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

        // Wait for Matrix sync to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

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
- Initialize blocks with specific properties
- Block ID (UUID) is auto-generated unless you provide one

**Example 1 - Create paragraph:**
\`\`\`json
{
  "blockType": "paragraph",
  "text": "This is a new paragraph in the document."
}
\`\`\`

**Example 2 - Create proposal:**
\`\`\`json
{
  "blockType": "proposal",
  "text": "",
  "attributes": {
    "status": "draft",
    "title": "New Governance Proposal",
    "description": "Detailed proposal description",
    "proposalId": "",
    "voteEnabled": true,
    "voteTitle": "Vote on this proposal",
    "icon": "square-check"
  }
}
\`\`\`

**Example 3 - Create checkbox:**
\`\`\`json
{
  "blockType": "checkbox",
  "attributes": {
    "checked": false,
    "title": "Complete KYC verification",
    "description": "Submit required documents",
    "icon": "square-check",
    "allowedCheckers": "all",
    "initialChecked": false
  }
}
\`\`\`

**Example 4 - Create API request:**
\`\`\`json
{
  "blockType": "apiRequest",
  "attributes": {
    "title": "Fetch user data",
    "description": "Get user profile from API",
    "endpoint": "https://api.example.com/users/123",
    "method": "GET",
    "headers": "[]",
    "body": "[]",
    "status": "idle"
  }
}
\`\`\`

**Example 5 - Create list:**
\`\`\`json
{
  "blockType": "list",
  "attributes": {
    "title": "DAO Members",
    "did": "did:ixo:entity123",
    "fragmentIdentifier": "members"
  }
}
\`\`\`

**Complete Attributes by Block Type:**

**paragraph**
  - No special attributes (just use 'text' parameter)

**proposal** (typical defaults shown)
  - status: "draft" (or "open" | "passed" | "rejected" | "executed" | "closed" | "execution_failed" | "veto_timelock")
  - title: string
  - description: string
  - proposalId: string (usually empty initially, filled when created on-chain)
  - actions: string (JSON array, e.g., "[]")
  - voteEnabled: boolean (default: false)
  - voteTitle: string
  - voteSubtitle: string
  - voteIcon: string (default: "checklist")
  - daysLeft: number (default: 0)
  - proposalContractAddress: string
  - coreAddress: string
  - conditions: string (JSON, default: "")

**checkbox** (typical defaults shown)
  - checked: boolean (default: false)
  - title: string
  - description: string
  - icon: string (default: "square-check")
  - allowedCheckers: "all" | "specific" | string array (default: "all")
  - initialChecked: boolean (default: false)
  - conditions: string (JSON, default: "")

**apiRequest** (typical defaults shown)
  - title: string
  - description: string
  - endpoint: string
  - method: "GET" | "POST" | "PUT" | "DELETE" (default: "GET")
  - headers: string (JSON array, default: "[]")
  - body: string (JSON array, default: "[]")
  - response: string (default: "")
  - status: "idle" | "loading" | "success" | "error" (default: "idle")
  - conditions: string (JSON, default: "")

**list** (typical defaults shown)
  - title: string
  - did: string (Decentralized Identifier)
  - fragmentIdentifier: string (e.g., "assets", "members", "proposals")
  - conditions: string (JSON, default: "")

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

  // Return only read-only tool if readOnly mode is enabled
  if (readOnly) {
    return {
      listBlocksTool,
    };
  }

  return {
    listBlocksTool,
    editBlockTool,
    createBlockTool,
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
