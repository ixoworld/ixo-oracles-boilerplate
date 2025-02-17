interface IMessage {
  id: string;
  content: React.ReactNode | string;
  type: 'ai' | 'human';
  toolCalls?: IMessageToolCall[];
}

interface IMessageToolCall {
  name: string;
  id: string;
  args: unknown;
  status?: 'isRunning' | 'done';
}

type UIComponents = Record<string, React.FC<unknown>>;

type UseListMessagesProps = {
  sessionId: string;
  uiComponents?: Partial<UIComponents>;
};

type UseSendMessageProps = {
  sessionId: string;
};

type UseSendMessageReturn = {
  sendMessage: (message: string) => Promise<void>;
  isSending: boolean;
  error: Error | null;
};

type MessagesMap = Record<string, IMessage>;

type StreamOracleResponseParams = {
  apiURL: string;
  apiKey: string;
  did: string;
  matrixAccessToken: string;
  message: string;
  connectionId?: string;
  sessionId: string;
  cb: Callback;
};

type Callback = ({
  requestId,
  message,
}: {
  requestId: string;
  message: string;
}) => Promise<void>;

export type {
  Callback,
  IMessage,
  IMessageToolCall,
  MessagesMap,
  StreamOracleResponseParams,
  UIComponents,
  UseListMessagesProps,
  UseSendMessageProps,
  UseSendMessageReturn,
};
