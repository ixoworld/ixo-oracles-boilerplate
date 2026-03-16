/**
 * Shared utilities for task job processors.
 *
 * @see spec §21 — Execution Logs as Room Events
 */

import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { MatrixManager } from '@ixo/matrix';
import { getMatrixHomeServerCroppedForDid } from '@ixo/oracles-chain-client';

import type { ENV } from 'src/types';
import { normalizeDid } from 'src/utils/header.utils';

import { getModelForRole, type ModelRole } from 'src/graph/llm-provider';

import type { ModelTier, NotificationPolicy, TaskMeta } from '../task-meta';

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

/** Maximum consecutive failures before auto-pausing */
export const MAX_CONSECUTIVE_FAILURES = 5;

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

// ── Job Data Validation Schemas ─────────────────────────────────────

export const SimpleJobDataSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
  roomId: z.string().min(1),
  message: z.string(),
});

export const WorkJobDataSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
  roomId: z.string().min(1),
  forDeliveryAt: z.string().optional(),
});

export const DeliverJobDataSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
  roomId: z.string().min(1),
});

// ── Helpers ──────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap a message with a Matrix mention pill for the given userId.
 * Matrix mention format: `<a href="https://matrix.to/#/@user:server">@user</a>`
 */
export function buildMentionMessage(message: string, userId: string): string {
  const displayName = escapeHtml(userId.split(':')[0].replace('@', ''));
  const safeUserId = encodeURI(userId);
  const safeMessage = escapeHtml(message);
  return `<a href="https://matrix.to/#/${safeUserId}">@${displayName}</a> ${safeMessage}`;
}

/** Check if a task status allows execution */
export function isTaskRunnable(meta: { status: string }): boolean {
  return meta.status === 'active' || meta.status === 'dry_run';
}

/**
 * Format a date as a short display string: "Mar 16, 2:30 PM"
 */
export function formatOutputDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
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
 * Resolve the main room ID for a user from their Matrix user ID.
 * Uses the same pattern as MessagesService.prepareForQuery().
 */
export async function resolveMainRoomId(
  userId: string,
  config: ConfigService<ENV>,
): Promise<string> {
  const did = normalizeDid(userId);
  const userHomeServer = await getMatrixHomeServerCroppedForDid(did);
  const mxManager = MatrixManager.getInstance();
  const { roomId } = await mxManager.getOracleRoomIdWithHomeServer({
    userDid: did,
    oracleEntityDid: config.getOrThrow('ORACLE_ENTITY_DID'),
    userHomeServer,
  });
  if (!roomId) {
    throw new Error(
      `Could not resolve main room for user ${userId} (did: ${did})`,
    );
  }
  return roomId;
}

/**
 * Send a task notification respecting the notification policy.
 * Shared by SimpleProcessor and DeliverProcessor to avoid duplication.
 */
export async function sendTaskNotification(params: {
  roomId: string;
  userId: string;
  message: string;
  notificationPolicy: NotificationPolicy;
  isDryRun: boolean;
}): Promise<string | undefined> {
  if (params.isDryRun || params.notificationPolicy === 'silent') {
    return undefined;
  }

  const mxManager = MatrixManager.getInstance();

  if (params.notificationPolicy === 'channel_and_mention') {
    const client = mxManager.getClient();
    if (client) {
      return await client.sendMessage({
        roomId: params.roomId,
        message: params.message,
        type: 'html',
        formattedBody: buildMentionMessage(params.message, params.userId),
      });
    }
    return undefined;
  }

  // channel_only, on_threshold, or any other policy
  return await mxManager.sendMessage({
    roomId: params.roomId,
    message: params.message,
    isOracleAdmin: true,
  });
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

  try {
    const meta = await params.getTask();
    const failures = meta.consecutiveFailures + 1;
    const updates: Partial<TaskMeta> = { consecutiveFailures: failures };

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      updates.status = 'paused';
      params.logger.warn(
        `Task ${params.taskId} auto-paused after ${failures} consecutive failures`,
      );

      const mxManager = MatrixManager.getInstance();
      await mxManager
        .sendMessage({
          roomId: params.roomId,
          message: `Task ${params.taskId} has been paused after ${failures} consecutive failures. Resume it when you're ready.`,
          isOracleAdmin: true,
        })
        .catch(() => {});
    }

    await params.updateTask(updates);
  } catch (innerError) {
    params.logger.error(
      `Failed to update task meta after failure: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
    );
  }
}
