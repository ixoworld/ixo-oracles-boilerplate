import {
  type BrowserToolCallEventPayload,
  type RenderComponentEventPayload,
  type ToolCallEventPayload,
} from '@ixo/oracles-events/types';
import { type IBrowserTools } from '../../../types/browser-tool.type.js';
import {
  type SSEErrorEventData,
  type SSEReasoningEventData,
  type SSEToolCallEventData,
} from '../../../utils/sse-parser.js';
import { type UIComponents } from '../resolve-ui-component.js';
import { type OracleChat } from './oracle-chat.js';

// Component metadata for deferred rendering
export interface IComponentMetadata {
  name: string;
  props: {
    id: string;
    args: unknown;
    status?: 'isRunning' | 'done';
    output?: string;
    event?: any;
    payload?: any;
    isToolCall?: boolean;
    toolName?: string; // Original tool name (for generic ToolCall component)
  };
}

// Message content can be string, array of strings/metadata, or single metadata
export type MessageContent =
  | string
  | IComponentMetadata
  | Array<string | IComponentMetadata>;

export interface IMessage {
  id: string;
  content: MessageContent;
  type: 'ai' | 'human';
  chunks?: number;
  toolCalls?: {
    name: string;
    id: string;
    args: unknown;
    status?: 'isRunning' | 'done';
    output?: string;
  }[];
  reasoning?: string;
  isComplete?: boolean;
  isReasoning?: boolean;
}

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

export interface IChatState {
  status: ChatStatus;
  error: Error | undefined;
  messages: IMessage[];
  pushMessage: (message: IMessage) => void;
  replaceMessage: (index: number, message: IMessage) => void;
  updateLastMessage: (updater: (msg: IMessage) => IMessage) => void;
  updateMessageById: (id: string, updater: (msg: IMessage) => IMessage) => void;
  snapshot: <T extends IMessage>(thing: T) => T;
  subscribe: (callback: () => void) => () => void;
}

export interface IChatOptions {
  oracleDid: string;
  sessionId: string;
  onPaymentRequiredError: (claimIds: string[]) => void;
  browserTools?: IBrowserTools;
  uiComponents?: UIComponents;
  overrides?: {
    baseUrl?: string;
    wsUrl?: string;
  };
  streamingMode?: 'batched' | 'immediate';
}

export interface ISendMessageOptions {
  oracleDid: string;
  sessionId: string;
  overrides?: {
    baseUrl?: string;
  };
  onPaymentRequiredError: (claimIds: string[]) => void;
  browserTools?: IBrowserTools;
  chatRef?: React.MutableRefObject<OracleChat>;
  refetchQueries?: () => Promise<void>;

  // NEW callbacks for streaming events
  onToolCall?: (toolCallData: SSEToolCallEventData) => Promise<void>;
  onActionCall?: (actionCallData: any) => Promise<void>;
  onError?: (error: SSEErrorEventData) => Promise<void>;
  onReasoning?: (data: {
    reasoningData: SSEReasoningEventData;
    requestId: string;
  }) => Promise<void>;
}

interface IUIComponentProps {
  id: string;
  isLoading?: boolean;
  output?: string;
}

// Extract the payload type more carefully to avoid Record<string, any> fallback
export type UIComponentProps<Ev extends AnyEvent> = IUIComponentProps &
  (Ev extends { payload: infer P } ? P : never);

// EVENT TYPES - simplified without useLiveEvents

export type ToolCallEvent = {
  eventName: 'tool_call';
  payload: ToolCallEventPayload;
};

export type RenderComponentEvent = {
  eventName: 'render_component';
  payload: RenderComponentEventPayload;
};

export type BrowserToolCallEvent = {
  eventName: 'browser_tool_call';
  payload: BrowserToolCallEventPayload;
};

export type AnyEvent =
  | ToolCallEvent
  | RenderComponentEvent
  | BrowserToolCallEvent;

export type { MessagesMap } from '../transform-to-messages-map.js';
