import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { useListMessages } from '..';
import {
  type IOraclesContextValue,
  OraclesProvider,
  type Socket,
} from '../../../oracles-provider';
import useLiveEvents from '../../../use-live-events/use-live-events';
import { listMessages } from '../../api';

jest.mock('../../api');
jest.mock('../../../use-live-events/use-live-events');

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

const mockListMessages = listMessages as jest.Mock;
const mockUseLiveEvents = useLiveEvents as jest.Mock;

describe('useListMessages', () => {
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
    uiComponents: {},
  };

  beforeEach(() => {
    queryClient.clear();
    jest.clearAllMocks();

    mockListMessages.mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          type: 'user',
          content: 'Hello',
        },
        {
          id: 'msg-2',
          type: 'ai',
          content: 'Hi there',
        },
      ],
    });

    mockUseLiveEvents.mockReturnValue({
      events: [],
      getLatestEvent: jest.fn().mockReturnValue(null),
    });
  });

  it('should initialize with correct default values', () => {
    const { result } = renderHook(() => useListMessages(defaultProps), {
      wrapper,
    });

    expect(result.current).toEqual({
      messages: [],
      isLoading: true,
      error: null,
    });
  });

  it('should fetch and transform messages successfully', async () => {
    const { result } = renderHook(() => useListMessages(defaultProps), {
      wrapper,
    });

    // Wait for the query to complete
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);

    expect(mockListMessages).toHaveBeenCalledWith({
      apiKey: mockContextValues.apiKey,
      apiUrl: mockContextValues.apiUrl,
      did: mockContextValues.config.did,
      matrixAccessToken: mockContextValues.config.matrixAccessToken,
      sessionId: defaultProps.sessionId,
      connectionId: mockContextValues.connectionId,
    });
  });

  it('should handle API errors', async () => {
    const errorMessage = 'Failed to fetch messages';
    mockListMessages.mockRejectedValueOnce(new Error(errorMessage));

    const { result } = renderHook(() => useListMessages(defaultProps), {
      wrapper,
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toHaveLength(0);
  });

  it('should not process events for different sessions', async () => {
    const mockEvent = {
      eventName: 'oracle:response',
      payload: {
        sessionId: 'different-session-id',
        eventId: 'event-1',
        requestId: 'req-1',
        content: 'New message',
      },
    };

    mockUseLiveEvents.mockReturnValue({
      events: [mockEvent],
      getLatestEvent: jest.fn().mockReturnValue(mockEvent),
    });

    const { result } = renderHook(() => useListMessages(defaultProps), {
      wrapper,
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.messages).toHaveLength(2); // Only initial messages, no event message
  });
});
