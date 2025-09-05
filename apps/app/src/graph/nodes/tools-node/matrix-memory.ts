// ========== TYPES ==========

import { MatrixManager } from '@ixo/matrix';
import { Logger } from '@nestjs/common';
import {
  MatrixMemoryBulkSaveEventContent,
  MatrixMemoryEventType,
  MatrixMemoryQueryEventContent,
  MemoryEngineQueryResponse,
  MessageDTO,
  TaskErrorPayload,
} from './types';

const matrixClient = MatrixManager.getInstance();

const sendMXEventWithResponse = async <T>(
  eventType: MatrixMemoryEventType,
  listenForEventType: MatrixMemoryEventType,
  content: any,
  roomId: string,
): Promise<T> => {
  let requestEventId: string | undefined;
  let cleanup: () => void = () => {};
  let cleanup2: () => void = () => {};
  let timeout: NodeJS.Timeout | undefined;
  try {
    const result = await new Promise<T>((resolve, reject) => {
      cleanup2 = matrixClient.onRoomEvent(
        roomId,
        MatrixMemoryEventType.MEMORY_TASK_ERROR,
        (event) => {
          if (
            event.type === MatrixMemoryEventType.MEMORY_TASK_ERROR &&
            (event.content as TaskErrorPayload).eventId === requestEventId
          ) {
            reject(new Error((event.content as TaskErrorPayload).error));
          }
        },
      );
      timeout = setTimeout(
        () => {
          cleanup();
          reject(
            new Error('Query timeout - no response received within 30 seconds'),
          );
        },
        60 * 1000 * 1, // 60 seconds timeout
      );

      cleanup = matrixClient.onRoomEvent(
        roomId,
        listenForEventType,
        (event) => {
          const content = event.content as any;

          // success response
          if (content.request_event_id === requestEventId) {
            // Clean up
            clearTimeout(timeout);

            Logger.debug(
              'Received success response for event type',
              eventType,
              content,
            );
            resolve(content as T);
          }
        },
      );

      // send the query event
      matrixClient
        .sendMatrixEvent(roomId, eventType, content as any)
        .then((eventId) => {
          requestEventId = eventId;
        })
        .catch((error) => {
          cleanup();
          clearTimeout(timeout);
          cleanup2();
          reject(error);
        });
    });
    return result;
  } catch (error) {
    Logger.error('Failed to send memory engine event:', error);
    cleanup();
    cleanup2();
    clearTimeout(timeout);
    throw error;
  }
};

/**
 * Send bulk save event to save multiple memories
 */
export async function sendBulkSave({
  memories,
  roomId,
  userDid,
  oracleDid,
}: {
  memories: MessageDTO[];
  roomId: string;
  userDid: string;
  oracleDid: string;
}): Promise<void> {
  const event: {
    type: MatrixMemoryEventType;
    content: MatrixMemoryBulkSaveEventContent;
  } = {
    type: MatrixMemoryEventType.MEMORY_BULK_SAVE,
    content: {
      memories,
      userDid,
      oracleDid: oracleDid,
    },
  };

  try {
    const result = await sendMXEventWithResponse(
      event.type,
      MatrixMemoryEventType.MEMORY_LOG,
      event.content,
      roomId,
    );
    Logger.debug('Bulk save event result:', result);
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
}): Promise<MemoryEngineQueryResponse['results']> {
  const queryEvent: {
    type: MatrixMemoryEventType.MEMORY_QUERY;
    content: MatrixMemoryQueryEventContent;
  } = {
    type: MatrixMemoryEventType.MEMORY_QUERY,
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
    const result = await sendMXEventWithResponse<MemoryEngineQueryResponse>(
      queryEvent.type,
      MatrixMemoryEventType.MEMORY_RESULTS,
      queryEvent.content,
      roomId,
    );
    return result.results;
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
        60 * 1000 * 1, // 60 seconds timeout
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
