import { type IMessage, type MessagesMap } from '../types';

export function updateMessagesMap({
  messagesMap = {},
  requestId,
  message,
}: {
  messagesMap: MessagesMap;
  requestId: string;
  message: string;
}): { updatedMap: MessagesMap; updatedMessage: IMessage } {
  // Get existing message or create new one
  const existingMessage = messagesMap[requestId] || {
    id: requestId,
    content: '',
    type: 'ai',
  };

  const updatedMessage: IMessage = {
    ...existingMessage,
    content:
      typeof existingMessage.content === 'string' ? (
        existingMessage.content + message
      ) : (
        <>
          {existingMessage.content}\n
          {message}
        </>
      ),
  };

  return {
    updatedMap: {
      ...messagesMap,
      [updatedMessage.id]: updatedMessage,
    },
    updatedMessage,
  };
}
