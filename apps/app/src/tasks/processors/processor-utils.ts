/**
 * Shared utilities for task job processors.
 *
 * @see spec §21 — Execution Logs as Room Events
 */

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as marked from 'marked';
import { z } from 'zod';

import { MatrixManager } from '@ixo/matrix';
import { getMatrixHomeServerCroppedForDid } from '@ixo/oracles-chain-client';

import type { ENV } from 'src/types';

import { getModelForRole, type ModelRole } from 'src/graph/llm-provider';

import { type SessionManagerService } from '@ixo/common';
import { normalizeDid } from 'src/utils/header.utils';
import type {
  ChannelType,
  ModelTier,
  NotificationPolicy,
  TaskMeta,
  TaskType,
} from '../task-meta';

// ── Model Tier → Role Mapping ────────────────────────────────────────

/** Maps task model tier to the LLM provider role used for model resolution. */
export const MODEL_TIER_ROLE_MAP: Record<ModelTier, ModelRole> = {
  low: 'custom_low',
  medium: 'custom_medium',
  high: 'main',
};

/**
 * Resolve the model name for a task based on its tier and optional override.
 * Returns { modelName, modelRole } so the caller can log which was selected.
 */
export function resolveModelForTask(
  modelTier: ModelTier,
  modelOverride: string | null,
): { modelName: string; modelRole: ModelRole | null } {
  if (modelOverride) {
    return { modelName: modelOverride, modelRole: null };
  }
  const role = MODEL_TIER_ROLE_MAP[modelTier];
  return { modelName: getModelForRole(role), modelRole: role };
}

// ── Constants ────────────────────────────────────────────────────────

/** Custom Matrix event type posted after each task run */
export const TASK_RUN_EVENT_TYPE = 'ixo.ora.task.run';

/** Custom Matrix event type for approval requests */
export const APPROVAL_REQUEST_EVENT_TYPE = 'ixo.ora.task.approval';

/** Maximum consecutive failures before auto-pausing */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** How long to wait before sending a reminder for pending approvals (24h) */
export const APPROVAL_REMINDER_MS = 24 * 60 * 60 * 1000;

/** How long to wait before auto-discarding a pending approval (48h) */
export const APPROVAL_EXPIRY_MS = 48 * 60 * 60 * 1000;

/** Redis key prefix for storing pending work results awaiting approval */
export const APPROVAL_RESULT_PREFIX = 'task:approval:';

/** TTL for approval results in Redis (48h + 1h buffer) */
export const APPROVAL_RESULT_TTL_SECONDS = 49 * 60 * 60;

// ── Types ────────────────────────────────────────────────────────────

/** Content of the `ixo.ora.task.run` custom event */
export interface TaskRunEventContent {
  taskId: string;
  runAt: string;
  status: 'success' | 'failure';
  totalRuns: number;
  /** One-line summary for UI display */
  summary?: string;
  /** Token usage for flow jobs */
  tokensUsed?: number;
  /** Cost in USD for flow jobs */
  costUsd?: number;
}

/** Context passed to configurable so main-agent can detect autonomous task mode */
export interface TaskExecutionContext {
  taskId: string;
  taskType: TaskType;
  runNumber: number;
  scheduleCron: string | null;
  timezone: string;
  totalCostUsd: number;
  monthlyBudgetUsd: number | null;
  consecutiveFailures: number;
  channelType: ChannelType;
}

/** Return value from the Work processor */
export interface WorkResult {
  skipped: boolean;
  result: string;
  tokensUsed: number;
  costUsd: number;
  modelUsed: string;
  startedAt: string;
  completedAt: string;
}

// ── Approval Gate Types ─────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** Content of the `ixo.ora.task.approval` custom event */
export interface ApprovalRequestEventContent {
  taskId: string;
  status: ApprovalStatus;
  preview: string;
  requestedAt: string;
  resolvedAt?: string;
}

/** Data payload for the approval timeout queue */
export interface ApprovalJobData {
  taskId: string;
  userDid: string;
  matrixUserId: string;
  roomId: string;
  mainRoomId: string;
  /** Whether this is a reminder (24h) or final expiry (48h) */
  phase: 'reminder' | 'expiry';
}

// ── Job Data Validation Schemas ─────────────────────────────────────

export const SimpleJobDataSchema = z.object({
  taskId: z.string().min(1),
  userDid: z.string().min(1),
  matrixUserId: z.string().min(1),
  roomId: z.string().min(1),
  message: z.string(),
  title: z.string().optional(),
  taskType: z.string().optional(),
  scheduleCron: z.string().optional(),
});

export const WorkJobDataSchema = z.object({
  taskId: z.string().min(1),
  userDid: z.string().min(1),
  roomId: z.string().min(1),
  forDeliveryAt: z.string().optional(),
  title: z.string().optional(),
  taskType: z.string().optional(),
  scheduleCron: z.string().optional(),
});

export const DeliverJobDataSchema = z.object({
  taskId: z.string().min(1),
  userDid: z.string().min(1),
  matrixUserId: z.string().min(1),
  roomId: z.string().min(1),
  title: z.string().optional(),
  taskType: z.string().optional(),
  scheduleCron: z.string().optional(),
});

const logger = new Logger('ProcessorUtils');

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Compute the work job delay given a delivery timestamp and the desired buffer.
 * If the buffer exceeds the available window, clips it to 80% of that window
 * and logs a warning so the task still fires instead of silently misbehaving.
 *
 * @param deliverAtMs  Epoch ms when the deliver job fires (absolute)
 * @param bufferMs     Desired buffer in ms (from complexityTier)
 * @param taskLogger   Logger instance for warnings
 * @param taskId       For log context
 * @returns workDelay in ms (delay before the work job starts)
 */
export function resolveWorkDelay(
  deliverAtMs: number,
  bufferMs: number,
  taskLogger: Logger,
  taskId: string,
): number {
  const availableMs = deliverAtMs - Date.now();

  if (availableMs <= 0) {
    taskLogger.warn(
      `Task ${taskId}: delivery time is in the past, starting work immediately`,
    );
    return 0;
  }

  if (bufferMs >= availableMs) {
    const effectiveBufferMs = Math.floor(availableMs * 0.8);
    taskLogger.warn(
      `Task ${taskId}: buffer (${Math.round(bufferMs / 60_000)}min) exceeds ` +
        `available window (${Math.round(availableMs / 60_000)}min). ` +
        `Clipping buffer to ${Math.round(effectiveBufferMs / 60_000)}min.`,
    );
    return Math.max(availableMs - effectiveBufferMs, 0);
  }

  return availableMs - bufferMs;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap a message with a Matrix mention pill for the given matrixUserId.
 * Matrix mention format: `<a href="https://matrix.to/#/@user:server">@user</a>`
 */
export function buildMentionMessage(
  message: string,
  matrixUserId: string,
): string {
  const displayName = escapeHtml(matrixUserId.split(':')[0].replace('@', ''));
  const safeUserId = encodeURI(matrixUserId);
  const htmlBody = marked.parse(message, { gfm: true }) as string;
  return `<a href="https://matrix.to/#/${safeUserId}">@${displayName}</a> ${htmlBody}`;
}

/** Check if a task status allows execution */
export function isTaskRunnable(meta: { status: string }): boolean {
  return meta.status === 'active' || meta.status === 'dry_run';
}

/**
 * Format a date as a short display string: "Mar 16, 2:30 PM"
 */
export function formatOutputDate(date: Date, timezone?: string): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timezone && { timeZone: timezone }),
  });
}

/**
 * Truncate text to a maximum length with ellipsis.
 */
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * Collapse rich markdown to a clean one-liner suitable for display
 * in the "Recent Output" section. Strips headings, images, links,
 * code blocks, bold/italic markers, and pipes.
 */
export function sanitizeSummary(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '') // strip heading markers
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → link text
    .replace(/```[\s\S]*?```/g, '') // fenced code blocks
    .replace(/`[^`\n]*`/g, '') // inline code
    .replace(/[*_]{1,3}/g, '') // bold/italic markers
    .replace(/\|/g, '–') // pipes → dashes
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/**
 * Resolve the main room ID for a user from their DID.
 * Uses the same pattern as MessagesService.prepareForQuery().
 */
export async function resolveMainRoomId(
  userDid: string,
  config: ConfigService<ENV>,
): Promise<string> {
  logger.debug(`resolveMainRoomId: looking up homeserver for did=${userDid}`);
  const userHomeServer = await getMatrixHomeServerCroppedForDid(userDid);
  logger.debug(`resolveMainRoomId: homeserver=${userHomeServer}`);
  const mxManager = MatrixManager.getInstance();
  const oracleEntityDid = config.getOrThrow('ORACLE_ENTITY_DID');
  logger.debug(
    `resolveMainRoomId: looking up room (oracleEntityDid=${oracleEntityDid}, userHomeServer=${userHomeServer})`,
  );
  const { roomId } = await mxManager.getOracleRoomIdWithHomeServer({
    userDid,
    oracleEntityDid,
    userHomeServer,
  });
  if (!roomId) {
    logger.error(`resolveMainRoomId: no room found for user did=${userDid}`);
    throw new Error(`Could not resolve main room for user (did: ${userDid})`);
  }
  logger.debug(`resolveMainRoomId: resolved roomId=${roomId}`);
  return roomId;
}

/**
 * Send a task notification respecting the notification policy.
 * Shared by SimpleProcessor and DeliverProcessor to avoid duplication.
 *
 * Every sent event includes `ixo.task_id` in its content (via metadata)
 * so clients can associate messages with the originating task.
 */
export async function sendTaskNotification(params: {
  roomId: string;
  matrixUserId: string;
  message: string;
  notificationPolicy: NotificationPolicy;
  isDryRun: boolean;
  sessionId?: string;
  sessionManagerService: SessionManagerService;
  configService: ConfigService<ENV>;
}): Promise<string | undefined> {
  logger.debug(
    `sendTaskNotification: policy=${params.notificationPolicy}, isDryRun=${params.isDryRun}, roomId=${params.roomId}, messageLen=${params.message.length}`,
  );

  if (params.isDryRun || params.notificationPolicy === 'silent') {
    logger.debug(
      `sendTaskNotification: skipped (${params.isDryRun ? 'dry_run' : 'silent policy'})`,
    );
    return undefined;
  }

  const mxManager = MatrixManager.getInstance();
  const taskMetadata = { sessionId: params.sessionId };
  const userDid = normalizeDid(params.matrixUserId);

  const sessionParams = {
    did: userDid,
    oracleDid: params.configService.getOrThrow('ORACLE_DID'),
    oracleEntityDid: params.configService.getOrThrow('ORACLE_ENTITY_DID'),
    oracleName: params.configService.getOrThrow('ORACLE_NAME'),
  };
  if (
    params.notificationPolicy === 'channel_and_mention' ||
    params.notificationPolicy === 'on_threshold'
  ) {
    const client = mxManager.getClient();
    if (client) {
      logger.debug(
        `sendTaskNotification: sending with mention to ${params.matrixUserId}`,
      );
      const eventId = await client.sendMessage({
        roomId: params.roomId,
        message: params.message,
        type: 'html',
        formattedBody: buildMentionMessage(params.message, params.matrixUserId),
        metadata: taskMetadata,
      });
      await params.sessionManagerService.createSession(sessionParams, eventId);

      logger.debug(
        `sendTaskNotification: sent with mention, eventId=${eventId}`,
      );
      return eventId;
    }
    logger.warn(`sendTaskNotification: no Matrix client available for mention`);
    return undefined;
  }

  // channel_only or on_threshold (threshold gate is handled upstream in DeliverProcessor)
  logger.debug(
    `sendTaskNotification: sending as channel_only (policy=${params.notificationPolicy})`,
  );
  const eventId = await mxManager.sendMessage({
    roomId: params.roomId,
    message: params.message,
    isOracleAdmin: false,
    disablePrefix: true,
    metadata: taskMetadata,
  });
  await params.sessionManagerService.createSession(sessionParams, eventId);

  logger.debug(`sendTaskNotification: sent, eventId=${eventId}`);
  return eventId;
}

/**
 * Handle job failure: increment consecutiveFailures, auto-pause at threshold,
 * and notify the user. Shared by SimpleProcessor and DeliverProcessor.
 *
 * @param params.getTask - Function to fetch task meta (should bypass cache)
 * @param params.updateTask - Function to update task meta
 */
export async function handleJobFailure(params: {
  error: unknown;
  taskId: string;
  mainRoomId: string;
  roomId: string;
  getTask: () => Promise<TaskMeta>;
  updateTask: (updates: Partial<TaskMeta>) => Promise<unknown>;
  logger: Logger;
}): Promise<void> {
  const errorMsg =
    params.error instanceof Error ? params.error.message : String(params.error);
  params.logger.error(`Job for task ${params.taskId} failed: ${errorMsg}`);
  if (params.error instanceof Error && params.error.stack) {
    params.logger.debug(`Failure stack trace: ${params.error.stack}`);
  }

  try {
    params.logger.debug(
      `handleJobFailure: fetching fresh TaskMeta for ${params.taskId}...`,
    );
    const meta = await params.getTask();
    const failures = meta.consecutiveFailures + 1;
    const updates: Partial<TaskMeta> = { consecutiveFailures: failures };
    params.logger.debug(
      `handleJobFailure: task ${params.taskId} consecutiveFailures=${failures}/${MAX_CONSECUTIVE_FAILURES}`,
    );

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      updates.status = 'paused';
      params.logger.warn(
        `Task ${params.taskId} auto-paused after ${failures} consecutive failures`,
      );

      params.logger.debug(
        `handleJobFailure: sending auto-pause notification to room ${params.roomId}`,
      );
      const mxManager = MatrixManager.getInstance();
      await mxManager
        .sendMessage({
          roomId: params.roomId,
          message: `⚠️ Task has been paused after ${failures} consecutive failures. Resume it when you're ready.`,
          isOracleAdmin: false,
          disablePrefix: true,
        })
        .catch((notificationErr) => {
          params.logger.warn(
            `handleJobFailure: failed to send auto-pause notification: ${notificationErr instanceof Error ? notificationErr.message : String(notificationErr)}`,
          );
        });
    }

    params.logger.debug(
      `handleJobFailure: updating TaskMeta: ${JSON.stringify(updates)}`,
    );
    await params.updateTask(updates);
    params.logger.debug(
      `handleJobFailure: TaskMeta updated for ${params.taskId}`,
    );
  } catch (innerError) {
    params.logger.error(
      `Failed to update task meta after failure: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
    );
    if (innerError instanceof Error && innerError.stack) {
      params.logger.debug(`Inner error stack: ${innerError.stack}`);
    }
  }
}

// ── Approval Classification ─────────────────────────────────────────

import { getProviderChatModel } from 'src/graph/llm-provider';
import { HumanMessage, SystemMessage } from 'langchain';

/** Fast-path regex for obvious single-word responses (no LLM call needed). */
const OBVIOUS_APPROVE = /^(yes|approve|confirmed|lgtm)\.?!?$/i;
const OBVIOUS_REJECT = /^(no|reject|discard)\.?!?$/i;

const APPROVAL_CLASSIFIER_PROMPT = `You are a binary classifier. The user has a pending task result waiting for their approval.
Given the user's message, determine if they are:
- APPROVING the result (wanting it delivered) — reply exactly: APPROVE
- REJECTING the result (wanting it discarded) — reply exactly: REJECT
- Saying something UNRELATED to the approval — reply exactly: NEITHER

Only reply with one word: APPROVE, REJECT, or NEITHER. Nothing else.`;

/**
 * Classify a user's message as an approval decision using a cheap LLM.
 *
 * Uses a two-tier approach:
 * 1. Fast regex for obvious cases ("yes", "no", "approve", "reject")
 * 2. LLM call (guard-tier model) for ambiguous messages
 *
 * Returns 'approved', 'rejected', or null if unrelated.
 */
export async function classifyApprovalResponse(
  text: string,
): Promise<'approved' | 'rejected' | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Fast path: obvious single-word responses
  if (OBVIOUS_APPROVE.test(trimmed)) return 'approved';
  if (OBVIOUS_REJECT.test(trimmed)) return 'rejected';

  // Skip very long messages — unlikely to be approval responses
  if (trimmed.length > 200) return null;

  try {
    const model = getProviderChatModel('guard', {
      temperature: 0,
      maxTokens: 5,
    });

    const response = await model.invoke([
      new SystemMessage(APPROVAL_CLASSIFIER_PROMPT),
      new HumanMessage(trimmed),
    ]);

    const answer = String(response.content).trim().toUpperCase();

    if (answer.startsWith('APPROVE')) return 'approved';
    if (answer.startsWith('REJECT')) return 'rejected';
    return null;
  } catch (err) {
    logger.warn(
      `Approval classifier failed, falling back to null: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Synchronous fast-path check for obvious approval responses.
 * Used by the approval API endpoint where the FE already knows the decision.
 */
export function parseApprovalResponse(
  text: string,
): 'approved' | 'rejected' | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (OBVIOUS_APPROVE.test(trimmed)) return 'approved';
  if (OBVIOUS_REJECT.test(trimmed)) return 'rejected';
  return null;
}

/**
 * Format the approval request message sent to the user.
 */
export function formatApprovalRequestMessage(
  taskId: string,
  preview: string,
): string {
  const truncatedPreview = truncateText(preview, 500);
  return [
    `**Task result ready for review**`,
    '',
    truncatedPreview,
    '',
    'Reply with **yes** to deliver, or **no** to discard.',
  ].join('\n');
}
