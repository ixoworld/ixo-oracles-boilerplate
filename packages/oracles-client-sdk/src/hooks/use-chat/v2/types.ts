import {
  type BrowserToolCallEventPayload,
  type RenderComponentEventPayload,
  type ToolCallEventPayload,
} from '@ixo/oracles-events/types';
import { type ReactNode } from 'react';
import { type IBrowserTools } from '../../../types/browser-tool.type.js';
import { type Event } from '../../use-live-events/use-live-events.hook.js';
import { type UIComponents } from '../resolve-ui-component.js';
import { type OracleChat } from './oracle-chat.js';

export interface IMessage {
  id: string;
  content: ReactNode | string;
  type: 'ai' | 'human';
  chunks?: number;
  toolCalls?: {
    name: string;
    id: string;
    args: unknown;
    status?: 'isRunning' | 'done';
    output?: string;
  }[];
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
  uiComponents?: Partial<UIComponents>;
  overrides?: {
    baseUrl?: string;
    wsUrl?: string;
  };
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
}

interface IUIComponentProps {
  id: string;
  isLoading?: boolean;
  output?: string;
}

// Extract the payload type more carefully to avoid Record<string, any> fallback
export type UIComponentProps<Ev extends AnyEvent> = IUIComponentProps &
  (Ev extends { payload: infer P } ? P : never);

// EVENT _TYPES

export type ToolCallEvent = Event<ToolCallEventPayload>;

export type RenderComponentEvent = Event<RenderComponentEventPayload>;

export type BrowserToolCallEvent = Event<BrowserToolCallEventPayload>;

export type AnyEvent =
  | ToolCallEvent
  | RenderComponentEvent
  | BrowserToolCallEvent;

export type { MessagesMap } from '../transform-to-messages-map.js';
