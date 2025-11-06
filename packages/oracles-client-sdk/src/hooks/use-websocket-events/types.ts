import type { WithRequiredEventProps } from '@ixo/oracles-events/types';
import { type IBrowserTools } from '../../types/browser-tool.type.js';

export type WebSocketEvent<T = Record<string, any>> = {
  eventName: string;
  payload: WithRequiredEventProps<T>;
};

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface IWebSocketConfig {
  oracleDid: string;
  sessionId: string;
  handleInvalidateCache?: () => void;
  handleNewEvent: (event: WebSocketEvent) => void;
  browserTools?: IBrowserTools;
  overrides?: {
    baseUrl?: string;
    wsUrl?: string;
  };
}

export interface IUseWebSocketEventsReturn {
  isConnected: boolean;
  error: Error | null;
  connectionStatus: ConnectionStatus;
  lastActivity: string | null;
  isConfigReady: boolean;
}
