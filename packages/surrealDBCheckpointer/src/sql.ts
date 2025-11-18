import { type Checkpoint } from "@langchain/langgraph-checkpoint";

export interface SQL_STATEMENTS {
  SELECT_SQL: string;
  UPSERT_CHECKPOINT_BLOBS_SQL: string;
  UPSERT_CHECKPOINTS_SQL: string;
  UPSERT_CHECKPOINT_WRITES_SQL: string;
  INSERT_CHECKPOINT_WRITES_SQL: string;
  DELETE_CHECKPOINTS_SQL: string;
  DELETE_CHECKPOINT_BLOBS_SQL: string;
  DELETE_CHECKPOINT_WRITES_SQL: string;
}

export type SQL_TYPES = {
  SELECT_SQL: {
    id: string;
    checkpoint: Omit<Checkpoint, "pending_sends" | "channel_values">;
    parent_checkpoint_id: string | null;
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    metadata: Record<string, unknown>;
  };
  UPSERT_CHECKPOINT_BLOBS_SQL: unknown;
  UPSERT_CHECKPOINTS_SQL: unknown;
  UPSERT_CHECKPOINT_WRITES_SQL: unknown;
  INSERT_CHECKPOINT_WRITES_SQL: unknown;
  DELETE_CHECKPOINTS_SQL: unknown;
  DELETE_CHECKPOINT_BLOBS_SQL: unknown;
  DELETE_CHECKPOINT_WRITES_SQL: unknown;
};

/**
 * Get SurrealQL query statements.
 * Note: Schema parameter is ignored in SurrealDB (kept for API compatibility).
 */
export const getSQLStatements = (_schema?: string): SQL_STATEMENTS => {
  return {
    // Select checkpoint data (blobs and writes fetched separately)
    SELECT_SQL: `SELECT 
      id,
      thread_id,
      checkpoint,
      checkpoint_ns,
      checkpoint_id,
      parent_checkpoint_id,
      metadata
    FROM checkpoints `, // Trailing space for WHERE clause concatenation

    // Upsert checkpoint blob using record link and ON DUPLICATE KEY UPDATE
    UPSERT_CHECKPOINT_BLOBS_SQL: `INSERT INTO checkpoint_blobs {
      checkpoint: <record>$checkpoint_id,
      channel: $channel,
      version: $version,
      type: $type,
      blob: $blob
    }
    ON DUPLICATE KEY UPDATE
      blob = $blob
    `,

    // Upsert checkpoint
    UPSERT_CHECKPOINTS_SQL: `INSERT INTO checkpoints {
      thread_id: $thread_id,
      checkpoint_ns: $checkpoint_ns,
      checkpoint_id: $checkpoint_id,
      parent_checkpoint_id: $parent_checkpoint_id,
      checkpoint: $checkpoint,
      metadata: $metadata
    }
    ON DUPLICATE KEY UPDATE
      checkpoint = $checkpoint,
      metadata = $metadata
    `,

    // Upsert checkpoint write using record link
    UPSERT_CHECKPOINT_WRITES_SQL: `INSERT INTO checkpoint_writes {
      checkpoint: <record>$checkpoint_id,
      task_id: $task_id,
      idx: $idx,
      channel: $channel,
      type: $type,
      blob: $blob
    }
    ON DUPLICATE KEY UPDATE
      channel = $channel,
      type = $type,
      blob = $blob
    `,

    // Insert checkpoint write (do nothing on conflict)
    INSERT_CHECKPOINT_WRITES_SQL: `INSERT INTO checkpoint_writes {
      checkpoint: <record>$checkpoint_id,
      task_id: $task_id,
      idx: $idx,
      channel: $channel,
      type: $type,
      blob: $blob
    }
    ON DUPLICATE KEY UPDATE checkpoint = <record>$checkpoint_id
    `,

    // Delete checkpoints by thread_id
    DELETE_CHECKPOINTS_SQL: `DELETE checkpoints WHERE thread_id = $thread_id`,

    // Delete checkpoint blobs by checkpoint record link
    DELETE_CHECKPOINT_BLOBS_SQL: `DELETE checkpoint_blobs WHERE checkpoint.thread_id = $thread_id`,

    // Delete checkpoint writes by checkpoint record link
    DELETE_CHECKPOINT_WRITES_SQL: `DELETE checkpoint_writes WHERE checkpoint.thread_id = $thread_id`,
  };
};
