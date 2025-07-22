// ========== TYPES ==========

import {
  type ClientEventHandlerMap,
  MatrixEventEvent,
  MatrixManager,
  RoomEvent,
} from '@ixo/matrix';
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
    strategy: string;
    centerNodeUuid?: string;
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
  userDid,
  strategy,
  centerNodeUuid,
}: {
  query: string;
  maxResults?: number;
  roomId: string;
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
    },
  };

  Logger.log('Querying memories', queryEvent.content);
  try {
    const result = await new Promise((resolve, reject) => {
      // eslint-disable-next-line prefer-const -- f
      let cleanup: (() => void) | undefined;

      const timeout = setTimeout(
        () => {
          cleanup?.();
          reject(
            new Error('Query timeout - no response received within 30 seconds'),
          );
        },
        60 * 1000 * 0.5, // 30 seconds timeout
      ); // 2 minutes timeout

      // Event listener for the response
      const eventListener: ClientEventHandlerMap[RoomEvent.Timeline] = (
        event,
        room,
        _,
        removed,
      ) => {
        // Only process events from our target room
        if (room?.roomId !== roomId) return;

        if (event.getType() === 'm.room.encrypted' && !removed) {
          event.once(MatrixEventEvent.Decrypted, (ev) => {
            // Check if this is our query results event
            if (ev.getType() === 'ixo.memory.results') {
              const content = ev.getContent<IQueryResultsEvent['content']>();

              // Match the request ID to ensure this is our response
              if (content.request_event_id === requestEventId) {
                // Clean up
                clearTimeout(timeout);
                cleanup?.();

                Logger.log(
                  `Query completed: found ${content.results.facts.length} results`,
                );
                resolve(content.results);
              }
            }
          });
        }
      };

      // Set up the listener before sending the query
      cleanup = matrixClient.listenToMatrixEvent(
        RoomEvent.Timeline,
        eventListener,
      );

      // Send the query event
      matrixClient
        .sendMatrixEvent(roomId, queryEvent.type, queryEvent.content)
        .then((ev) => {
          requestEventId = ev?.event_id;
        })
        .catch((error) => {
          // Clean up on send failure
          clearTimeout(timeout);
          cleanup?.();
          reject(error);
        });
    });
    return result as IQueryResultsEvent['content']['results'];
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
  const taskEvent = await matrixClient.sendMatrixEvent(
    params.roomId,
    'ixo.memory.task',
    task,
  );

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line prefer-const -- f
    let cleanup: (() => void) | undefined;

    const timeout = setTimeout(
      () => {
        cleanup?.();
        reject(
          new Error('Task timeout - no response received within 30 seconds'),
        );
      },
      60 * 1000 * 2,
    ); // 2 minutes timeout

    // Event listener for the response
    const eventListener: ClientEventHandlerMap[RoomEvent.Timeline] = (
      event,
      room,
      _,
      removed,
    ) => {
      // Only process events from our target room
      if (room?.roomId !== params.roomId) return;

      if (event.getType() === 'm.room.encrypted' && !removed) {
        event.once(MatrixEventEvent.Decrypted, (ev) => {
          if (ev.getType() === 'ixo.memory.task.error') {
            const content = ev.getContent<{ error: string }>();
            Logger.error(`Task error: ${content.error}`);
            reject(new Error(content.error));
          }

          // Check if this is our query results event
          if (ev.getType() === 'ixo.memory.task.acknowledgement') {
            const content = ev.getContent<{ eventId: string }>();

            // Match the request ID to ensure this is our response
            if (content.eventId === taskEvent?.event_id) {
              // Clean up
              clearTimeout(timeout);
              cleanup?.();

              Logger.log(`Task completed`);
              resolve();
            }
          }
        });
      }
    };

    // Set up the listener before sending the query
    cleanup = matrixClient.listenToMatrixEvent(
      RoomEvent.Timeline,
      eventListener,
    );
  });
}
