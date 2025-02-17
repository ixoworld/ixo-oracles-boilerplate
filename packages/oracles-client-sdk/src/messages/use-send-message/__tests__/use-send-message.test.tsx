import { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useSendMessage } from '..';
import { request } from '../../../helpers/request';
import {
  type IOraclesContextValue,
  OraclesProvider,
  type Socket,
} from '../../../oracles-provider';
import { streamOracleResponse } from '../stream-oracle-response';

jest.mock('../stream-oracle-response');
jest.mock('../../../helpers/request');

// Mock window.crypto.randomUUID
const mockRandomUUID = jest.fn(() => 'test-message-id');
Object.defineProperty(window, 'crypto', {
  value: { randomUUID: mockRandomUUID },
});

jest.mock('socket.io-react-hook', () => ({
  useSocket: jest.fn().mockReturnValue({
    socket: {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    },
  }),
  useSocketEvent: jest.fn(),
  IoProvider: ({ children }: { children: React.ReactNode }) => children,
}));
const mockContextValues: IOraclesContextValue = {
  apiKey: 'test-api-key',
  apiUrl: 'https://api.example.com',
  config: {
    did: 'test-did',
    matrixAccessToken: 'test-matrix-token',
  },
  connectionId: 'test-connection-id',
  socket: jest.fn() as unknown as Socket,
};

jest.mock('../../../oracles-provider', () => ({
  ...jest.requireActual('../../../oracles-provider'),
  useOraclesContext: jest.fn().mockReturnValue({
    connectionId: 'test-connection-id',
    apiKey: 'test-api-key',
    apiUrl: 'https://api.example.com',
    config: {
      did: 'test-did',
      matrixAccessToken: 'test-matrix-token',
    },
  }),
}));

const mockStreamOracleResponse = streamOracleResponse as jest.Mock;
const mockRequest = request as jest.Mock;

describe('useSendMessage', () => {
  // Create a new Query Client for testing
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
      },
    },
  });

  const wrapper = ({
    children,
  }: {
    children: React.ReactNode;
  }): React.ReactNode => (
    <OraclesProvider
      apiKey={mockContextValues.apiKey}
      apiUrl={mockContextValues.apiUrl}
      config={mockContextValues.config}
      overrideQueryClient={queryClient}
    >
      {children}
    </OraclesProvider>
  );

  const defaultProps = {
    sessionId: 'test-session-id',
  };

  beforeEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
    mockRandomUUID.mockClear();

    mockStreamOracleResponse.mockResolvedValue({
      text: 'test response',
      requestId: 'test-request-id',
    });
    mockRequest.mockResolvedValue({});
  });

  it('should initialize with correct default values', () => {
    const { result } = renderHook(() => useSendMessage(defaultProps), {
      wrapper,
    });

    expect(result.current).toEqual({
      sendMessage: expect.any(Function) as (message: string) => Promise<void>,
      isSending: false,
      error: null,
    });
  });

  it('should successfully send a message', async () => {
    const { result } = renderHook(() => useSendMessage(defaultProps), {
      wrapper,
    });

    const message = 'test message';
    await result.current.sendMessage(message);

    expect(mockStreamOracleResponse).toHaveBeenCalledWith({
      apiKey: mockContextValues.apiKey,
      apiURL: mockContextValues.apiUrl,
      did: mockContextValues.config.did,
      matrixAccessToken: mockContextValues.config.matrixAccessToken,
      message,
      connectionId: mockContextValues.connectionId,
      sessionId: defaultProps.sessionId,
      cb: expect.any(Function) as (params: {
        requestId: string;
        message: string;
      }) => Promise<void>,
    });

    // Verify that randomUUID was called
    expect(mockRandomUUID).toHaveBeenCalled();
  });

  it('should handle missing sessionId error', async () => {
    const { result } = renderHook(() => useSendMessage({ sessionId: '' }), {
      wrapper,
    });

    await expect(result.current.sendMessage('test message')).rejects.toThrow(
      'Session ID is required',
    );
  });

  it('should handle stream response error', async () => {
    const errorMessage = 'Stream error';
    mockStreamOracleResponse.mockRejectedValueOnce(new Error(errorMessage));

    const { result } = renderHook(() => useSendMessage(defaultProps), {
      wrapper,
    });

    await expect(result.current.sendMessage('test message')).rejects.toThrow(
      errorMessage,
    );
  });

  it('should update query cache after successful message send', async () => {
    const { result } = renderHook(() => useSendMessage(defaultProps), {
      wrapper,
    });

    const message = 'test message';
    await result.current.sendMessage(message);

    // Verify that the query cache was updated
    const messagesQueryKey = ['messages', defaultProps.sessionId];
    const cachedData = queryClient.getQueryData(messagesQueryKey);

    expect(cachedData).toBeDefined();
  });
});
