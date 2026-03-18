/**
 * Tool: apply_sandbox_output_to_block
 *
 * Reads a JSON file from the sandbox and writes its values directly to a
 * block's properties, bypassing LLM text generation.
 *
 * This solves the generic problem where LLMs truncate long opaque values
 * (JWTs, credentials, base64 data, long URLs) when composing tool-call
 * arguments.  By reading the file server-side and calling editBlock()
 * directly, the values are transferred byte-perfect.
 */

import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import type { StructuredTool } from 'langchain';
import * as z from 'zod';

import {
  editBlock,
  getBlockDetail,
  simplifyBlockForAgent,
} from './blocknote-helper';
import { BLOCKNOTE_TOOLS_CONFIG } from './blocknote-tools';
import type { AppConfig } from './provider';
import { EditorMatrixClient } from './editor-mx';
import { MatrixProviderManager } from './provider';

const logger = new Logger('ApplySandboxOutputToBlock');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a dot-notation path on an object (e.g. "data.credentials"). */
function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce((cur: unknown, key) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

/**
 * Parse the result returned by the sandbox_run MCP tool.
 *
 * The LangChain MCP adapter may return:
 *  - A plain JSON string  `"{ \"output\": \"...\", ... }"`
 *  - An MCP content array  `{ content: [{ type: "text", text: "..." }] }`
 *  - An already-parsed object
 */
function parseSandboxResult(raw: unknown): {
  output: string;
  success: boolean;
  error?: string;
  exitCode?: number;
} {
  if (typeof raw === 'string') {
    return JSON.parse(raw);
  }

  // MCP content-block envelope
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'content' in raw &&
    Array.isArray((raw as Record<string, unknown>).content)
  ) {
    const blocks = (raw as { content: Array<{ type: string; text: string }> })
      .content;
    const textBlock = blocks.find((b) => b.type === 'text');
    if (textBlock) {
      return JSON.parse(textBlock.text);
    }
  }

  // Already parsed
  return raw as {
    output: string;
    success: boolean;
    error?: string;
    exitCode?: number;
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const applySandboxOutputToBlockSchema = z.object({
  filePath: z
    .string()
    .describe(
      'Absolute path to the JSON file in the sandbox (e.g. /workspace/data/output/result.json)',
    ),
  blockId: z
    .string()
    .describe('The exact UUID of the block to update (get from list_blocks)'),
  fieldMapping: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Optional mapping from source JSON field names to block prop names. ' +
        'Use "." as source key to map the entire file content as one value. ' +
        'Use dot-notation in target to nest into JSON-string props (e.g. "inputs.credential"). ' +
        'Example flat: {"jwt_token": "kycCredential"}. ' +
        'Example nested: {".": "inputs.credential", "roomId": "inputs.roomId"}. ' +
        'If omitted, source field names are used as top-level block prop names directly.',
    ),
  jsonPath: z
    .string()
    .optional()
    .describe(
      'Optional dot-notation path to extract a nested object from the JSON before applying. ' +
        'Example: "result.credentials" extracts obj.result.credentials. ' +
        'If omitted, the top-level JSON object is used.',
    ),
  text: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Optional text content to set on the block. null keeps existing, empty string clears.',
    ),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface CreateParams {
  /** The sandbox_run tool (should be the wrapped version with lazy secret injection). */
  sandboxRunTool: StructuredTool;
  /** Matrix room ID containing the Y.js document. */
  editorRoomId: string;
}

export function createApplySandboxOutputToBlockTool({
  sandboxRunTool,
  editorRoomId,
}: CreateParams): StructuredTool {
  return tool(
    async ({ filePath, blockId, fieldMapping, jsonPath, text }) => {
      logger.log(
        `📦 apply_sandbox_output_to_block: ${filePath} → block ${blockId}`,
      );

      // ── 1. Read file from sandbox ──────────────────────────────
      let fileContent: string;
      try {
        const execResult = await sandboxRunTool.invoke({
          code: `cat "${filePath}"`,
        });

        const parsed = parseSandboxResult(execResult);

        if (
          !parsed.success ||
          (parsed.exitCode != null && parsed.exitCode !== 0)
        ) {
          return JSON.stringify({
            success: false,
            error: `Failed to read sandbox file: ${parsed.error || 'Unknown error'}`,
            exitCode: parsed.exitCode,
          });
        }

        fileContent = parsed.output;
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `Sandbox file read failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      // ── 2. Parse JSON ──────────────────────────────────────────
      let data: Record<string, unknown>;
      try {
        const parsed = JSON.parse(fileContent.trim());

        let target = parsed;
        if (jsonPath) {
          target = resolvePath(parsed, jsonPath);
          if (target == null || typeof target !== 'object') {
            return JSON.stringify({
              success: false,
              error: `jsonPath "${jsonPath}" did not resolve to an object (got ${typeof target})`,
            });
          }
        }

        if (typeof target !== 'object' || Array.isArray(target)) {
          return JSON.stringify({
            success: false,
            error: `Expected a JSON object but got ${Array.isArray(target) ? 'array' : typeof target}`,
          });
        }

        data = target as Record<string, unknown>;
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      // ── 3. Apply field mapping ─────────────────────────────────
      let updates: Record<string, unknown>;

      if (fieldMapping && Object.keys(fieldMapping).length > 0) {
        updates = {};
        const warnings: string[] = [];

        for (const [sourceKey, targetProp] of Object.entries(fieldMapping)) {
          // "." means the entire file data as one value
          const sourceValue = sourceKey === '.' ? data : data[sourceKey];
          if (sourceValue === undefined && sourceKey !== '.') {
            warnings.push(
              `Source field "${sourceKey}" not found in sandbox output`,
            );
            continue;
          }

          if (targetProp.includes('.')) {
            // Dot-notation target: e.g. "inputs.credential"
            // Group nested fields into their parent prop
            const dotIdx = targetProp.indexOf('.');
            const parentProp = targetProp.slice(0, dotIdx);
            const nestedKey = targetProp.slice(dotIdx + 1);

            if (!updates[`__nested__${parentProp}`]) {
              updates[`__nested__${parentProp}`] = {};
            }
            (updates[`__nested__${parentProp}`] as Record<string, unknown>)[
              nestedKey
            ] = sourceValue;
          } else {
            updates[targetProp] = sourceValue;
          }
        }

        // Flatten nested groups into their parent props as objects
        // (applyAttributeUpdates will handle JSON-string merge)
        for (const key of Object.keys(updates)) {
          if (key.startsWith('__nested__')) {
            const parentProp = key.slice('__nested__'.length);
            updates[parentProp] = updates[key];
            delete updates[key];
          }
        }

        if (Object.keys(updates).length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No mapped fields found in sandbox output',
            warnings,
            availableFields: Object.keys(data),
          });
        }

        if (warnings.length > 0) {
          logger.warn(`Field mapping warnings: ${warnings.join(', ')}`);
        }
      } else {
        updates = { ...data };
      }

      // ── 4. Write to block via Y.js ─────────────────────────────
      const editorMatrixClient = EditorMatrixClient.getInstance();
      await editorMatrixClient.waitUntilReady();
      const matrixClient = editorMatrixClient.getClient();

      const appConfig: AppConfig = {
        matrix: {
          ...BLOCKNOTE_TOOLS_CONFIG.matrix,
          room: { type: 'id', value: editorRoomId },
        },
        provider: { ...BLOCKNOTE_TOOLS_CONFIG.provider },
        blocknote: { ...BLOCKNOTE_TOOLS_CONFIG.blocknote },
      };

      const providerManager = new MatrixProviderManager(
        matrixClient,
        appConfig,
      );

      try {
        const { doc } = await providerManager.init();

        const attributes =
          Object.keys(updates).length > 0 ? { props: updates } : {};

        editBlock(doc, {
          blockId,
          attributes,
          text: text === null || text === undefined ? undefined : text,
          docName: 'document',
        });

        const updatedBlock = getBlockDetail(doc, blockId, true);
        const simplified = updatedBlock
          ? simplifyBlockForAgent(updatedBlock)
          : null;

        return JSON.stringify({
          success: true,
          message: `Applied ${Object.keys(updates).length} field(s) from sandbox to block ${blockId}`,
          appliedFields: Object.keys(updates),
          block: simplified,
        });
      } catch (error) {
        logger.error('Error applying sandbox output to block:', error);
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await providerManager.dispose();
      }
    },
    {
      name: 'apply_sandbox_output_to_block',
      description: `Reads a JSON file from the sandbox and writes its values directly to a block's properties — bypassing LLM text generation entirely.

**When to use:**
- After a skill execution produces a JSON output file with long/opaque values (JWTs, credentials, tokens, base64 data, long URLs)
- When you need exact byte-perfect transfer of values to block properties
- Any value longer than ~200 characters that would be truncated if passed through edit_block manually

**Workflow:**
1. Run the skill in sandbox (sandbox_run) — ensure it writes output to a JSON file
2. Call list_blocks (via Editor Agent) to get the target block UUID
3. Call this tool with the output file path and block UUID
4. Values are transferred server-side without LLM generation

**Examples:**

Direct transfer (all fields as top-level props):
  {"filePath": "/workspace/data/output/result.json", "blockId": "uuid-here"}

With field mapping (flat):
  {"filePath": "/workspace/data/output/result.json", "blockId": "uuid-here", "fieldMapping": {"jwt_token": "kycCredential", "url": "kycUrl"}}

Nest into action block inputs (dot-notation target — use this for action blocks):
  {"filePath": "/workspace/data/output/credential.json", "blockId": "uuid-here", "fieldMapping": {".": "inputs.credential"}}
  This puts the entire file content as the "credential" field inside the block's "inputs" JSON-string prop.

Multiple fields into inputs:
  {"filePath": "/workspace/data/output/result.json", "blockId": "uuid-here", "fieldMapping": {"credential": "inputs.credential", "roomId": "inputs.roomId"}}

Extract nested object:
  {"filePath": "/workspace/data/output/result.json", "blockId": "uuid-here", "jsonPath": "data.credentials"}

**IMPORTANT for action blocks:** Action block inputs are stored as a JSON string in the \`inputs\` prop. Use dot-notation targets like \`inputs.credential\` to nest values correctly. Do NOT use direct transfer (no fieldMapping) on action blocks — it will spread fields as top-level props instead of into inputs.`,
      schema: applySandboxOutputToBlockSchema,
    },
  ) as unknown as StructuredTool;
}
