// ========== TYPES ==========

import {
  type ClientEventHandlerMap,
  MatrixEventEvent,
  MatrixManager,
  RoomEvent,
} from '@ixo/matrix';
import { Logger } from '@nestjs/common';

const matrixClient = MatrixManager.getInstance();

export interface MemoryMessage {
  content: string;
  role_type: 'user' | 'assistant' | 'system';
  name: string;
  timestamp?: string;
}

export interface BulkSaveEvent {
  type: 'ixo.memory.bulk_save';
  sender: string;
  content: {
    memories: MemoryMessage[];
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

export interface QueryEvent {
  type: 'ixo.memory.query';
  sender: string;
  content: {
    query: string;
    max_results?: number;
  };
}

export interface QueryResultsEvent {
  type: 'ixo.memory.query_results';
  sender: string;
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
  memories: MemoryMessage[];
  roomId: string;
  userDid: string;
}): Promise<void> {
  const event: BulkSaveEvent = {
    type: 'ixo.memory.bulk_save',
    sender: userDid,
    content: {
      memories,
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
  maxResults = 10,
  roomId,
  userDid,
}: {
  query: string;
  maxResults?: number;
  roomId: string;
  userDid: string;
}): Promise<QueryResultsEvent['content']['results']> {
  let requestEventId: string | undefined;
  await matrixClient.init();

  const queryEvent: QueryEvent = {
    type: 'ixo.memory.query',
    sender: userDid,
    content: {
      query,
      max_results: maxResults,
    },
  };

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line prefer-const -- f
    let cleanup: (() => void) | undefined;

    const timeout = setTimeout(() => {
      cleanup?.();
      reject(
        new Error('Query timeout - no response received within 30 seconds'),
      );
    }, 30000); // 30 second timeout

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
          Logger.log(ev);
          // Check if this is our query results event
          if (ev.getType() === 'ixo.memory.results') {
            const content = ev.getContent<QueryResultsEvent['content']>();

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
}
