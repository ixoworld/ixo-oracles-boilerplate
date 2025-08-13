// ========== TYPES ==========

import { MatrixManager } from '@ixo/matrix';
import { Logger } from '@nestjs/common';

const matrixClient = MatrixManager.getInstance();

export interface IMemoryMessage {
  content: string;
  role_type: 'user' | 'assistant' | 'system';
  name: string;
  timestamp?: string;
}

export interface IBulkSaveEvent {
  type: 'ixo.memory.bulk_save';
  content: {
    memories: IMemoryMessage[];
    userDid: string;
  };
}
interface IEnhancedSearchResults {
  facts: Array<{
    uuid: string;
    fact: string;
    source_node_uuid: string;
    target_node_uuid: string;
    created_at: string;
    valid_at: string;
    invalid_at: string | null;
  }>;
  entities: Array<{
    uuid: string;
    name: string;
    summary: string;
    labels: string[];
    group_id: string;
    created_at: string;
  }>;
  episodes: Array<{
    uuid: string;
    name: string;
    content: string;
    created_at: string;
    group_id: string;
  }>;
  communities: Array<{
    uuid: string;
    name: string;
    summary: string;
    created_at: string | null;
  }>;
}

export interface IQueryEvent {
  type: 'ixo.memory.query';
  content: {
    query: string;
    userDid: string;
    strategy?:
      | 'balanced'
      | 'recent_memory'
      | 'contextual'
      | 'precise'
      | 'entities_only'
      | 'topics_only';
    centerNodeUuid?: string;
    oracleDids: string[];
  };
}

export interface IQueryResultsEvent {
  type: 'ixo.memory.query_results';
  content: {
    request_event_id: string;
    results: IEnhancedSearchResults;
  };
}
/**
 * Send bulk save event to save multiple memories
 */
export async function sendBulkSave({
  memories,
  roomId,
  userDid,
}: {
  memories: IMemoryMessage[];
  roomId: string;
  userDid: string;
}): Promise<void> {
  const event: IBulkSaveEvent = {
    type: 'ixo.memory.bulk_save',
    content: {
      memories,
      userDid,
    },
  };

  try {
    const response = await matrixClient.sendMatrixEvent(
      roomId,
      event.type,
      event.content,
    );
    Logger.log(
      `Successfully sent ${memories.length} memories for bulk save`,
      response,
    );
  } catch (error) {
    Logger.error('Failed to send bulk save event:', error);
    throw error;
  }
}

/**
 * Query memories and wait for results
 * Returns a promise that resolves with the query results
 */
export async function queryMemories({
  query,
  roomId,
  oracleDid,
  userDid,
  strategy,
  centerNodeUuid,
}: {
  query: string;
  maxResults?: number;
  roomId: string;
  oracleDid: string;
  userDid: string;
  strategy:
    | 'balanced'
    | 'recent_memory'
    | 'contextual'
    | 'precise'
    | 'entities_only'
    | 'topics_only';
  centerNodeUuid?: string;
}): Promise<IQueryResultsEvent['content']['results']> {
  let requestEventId: string | undefined;
  await matrixClient.init();

  const queryEvent: IQueryEvent = {
    type: 'ixo.memory.query',
    content: {
      query,
      userDid,
      strategy,
      centerNodeUuid,
      oracleDids: [oracleDid],
    },
  };

  Logger.log('Querying memories', queryEvent.content);
  try {
    let cleanup: () => void;
    const result = await new Promise<IQueryResultsEvent['content']['results']>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => {
            cleanup();
            reject(
              new Error(
                'Query timeout - no response received within 30 seconds',
              ),
            );
          },
          60 * 1000 * 0.5, // 30 seconds timeout
        );

        cleanup = matrixClient.onRoomEvent<IQueryResultsEvent['content']>(
          roomId,
          'ixo.memory.results',
          (event) => {
            const content = event.content;
            if (content.request_event_id === requestEventId) {
              // Clean up
              clearTimeout(timeout);

              Logger.log(
                `Query completed: found ${content.results.facts.length} results`,
              );
              resolve(content.results);
            }
          },
        );

        // send the query event
        matrixClient
          .sendMatrixEvent(roomId, queryEvent.type, queryEvent.content)
          .then((eventId) => {
            requestEventId = eventId;
          })
          .catch((error) => {
            cleanup();
            clearTimeout(timeout);
            reject(error);
          });
      },
    );
    return result;
  } catch (error) {
    Logger.error('Failed to send query event:', error);
    return {
      facts: [],
      entities: [],
      episodes: [],
      communities: [],
    };
  }
}

export async function triggerMemoryAnalysisWorkflow(params: {
  userDid: string;
  sessionId: string;
  oracleDid: string;
  roomId: string;
}): Promise<void> {
  let requestEventId: string | undefined;
  await matrixClient.init();

  const task = {
    type: 'extract_memory_from_chat',
    payload: {
      userDid: params.userDid,
      sessionId: params.sessionId,
      oracleDid: params.oracleDid,
      roomId: params.roomId,
    },
  };

  Logger.log('Triggering memory analysis workflow', task);
  let cleanup: () => void;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          cleanup();
          reject(
            new Error('Task timeout - no response received within 30 seconds'),
          );
        },
        60 * 1000 * 0.5, // 30 seconds timeout
      );

      // Listen for acknowledgement event
      cleanup = matrixClient.onRoomEvent<{ eventId: string }>(
        params.roomId,
        'ixo.memory.task.acknowledgement',
        (event) => {
          const content = event.content;
          if (content.eventId === requestEventId) {
            // Clean up
            clearTimeout(timeout);
            Logger.log('Task completed');
            resolve();
          }
        },
      );

      // Send the task event
      matrixClient
        .sendMatrixEvent(params.roomId, 'ixo.memory.task', task)
        .then((eventId) => {
          requestEventId = eventId;
        })
        .catch((error) => {
          cleanup();
          clearTimeout(timeout);
          reject(error);
        });
    });
  } catch (error) {
    Logger.error('Failed to trigger memory analysis workflow:', error);
    throw error;
  }
}
