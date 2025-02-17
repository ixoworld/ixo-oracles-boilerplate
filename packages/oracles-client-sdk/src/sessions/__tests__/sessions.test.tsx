import { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { OraclesProvider } from '../../oracles-provider';
import * as api from '../api';

import {
  useCreateSession,
  useDeleteSession,
  useSessions,
  useUpdateSessionTitle,
} from '../sessions';

jest.mock('../api', () => ({
  listSessions: jest.fn(),
  createSession: jest.fn(),
  deleteSession: jest.fn(),
  updateSessionTitle: jest.fn(),
}));

const mockConfig = {
  apiUrl: 'https://api.example.com',
  apiKey: 'test-api-key',
  config: {
    did: 'test-did',
    oracleName: 'test-oracle',
    matrixAccessToken: 'test-token',
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const wrapper = ({ children }: { children: ReactNode }): React.ReactNode => (
  <OraclesProvider
    apiUrl={mockConfig.apiUrl}
    apiKey={mockConfig.apiKey}
    config={mockConfig.config}
    overrideQueryClient={queryClient}
  >
    {children}
  </OraclesProvider>
);

describe('Session Hooks', () => {
  beforeEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  describe('useSessions', () => {
    it('should fetch sessions', async () => {
      const mockSessions = {
        sessions: [
          {
            sessionId: '1',
            oracleName: 'test',
            title: 'Test Session',
            lastUpdatedAt: '2024-02-14',
            createdAt: '2024-02-14',
          },
        ],
      };

      jest.mocked(api.listSessions).mockResolvedValue(mockSessions);

      const { result } = renderHook(() => useSessions(), { wrapper });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockSessions);
      });

      expect(api.listSessions).toHaveBeenCalledWith({
        apiUrl: mockConfig.apiUrl,
        apiKey: mockConfig.apiKey,
        did: mockConfig.config.did,
        matrixAccessToken: mockConfig.config.matrixAccessToken,
      });
    });

    it('should share data between multiple hooks', async () => {
      const mockSessions = {
        sessions: [
          {
            sessionId: '1',
            oracleName: 'test',
            title: 'Test Session',
            lastUpdatedAt: '2024-02-14',
            createdAt: '2024-02-14',
          },
        ],
      };

      jest.mocked(api.listSessions).mockResolvedValue(mockSessions);

      // Render two hooks that use sessions
      const { result: result1 } = renderHook(() => useSessions(), { wrapper });
      const { result: result2 } = renderHook(() => useSessions(), { wrapper });

      // Wait for both hooks to have data
      await waitFor(() => {
        expect(result1.current.data).toBeDefined();
        expect(result2.current.data).toBeDefined();
      });

      // Verify both hooks have the same data
      expect(result1.current.data).toEqual(result2.current.data);
      // Verify we only called the API once (data is shared)
      expect(api.listSessions).toHaveBeenCalledTimes(1);
    });

    it('should update sessions list after creating a new session', async () => {
      // Initial sessions list
      const initialSessions = {
        sessions: [
          {
            sessionId: '1',
            oracleName: 'test',
            title: 'Test Session',
            lastUpdatedAt: '2024-02-14',
            createdAt: '2024-02-14',
          },
        ],
      };

      // New session to be created
      const newSession = {
        sessionId: '2',
        oracleName: 'new-oracle',
        title: 'New Session',
        lastUpdatedAt: '2024-02-14',
        createdAt: '2024-02-14',
      };

      // Updated sessions list that should be returned after creation
      const updatedSessions = {
        sessions: [newSession, ...initialSessions.sessions],
      };

      // Setup API mocks
      jest
        .mocked(api.listSessions)
        .mockResolvedValueOnce(initialSessions) // First call returns initial list
        .mockResolvedValueOnce(updatedSessions); // Second call returns updated list
      jest.mocked(api.createSession).mockResolvedValueOnce(newSession);

      // Render both hooks we want to test
      const { result: sessionsList } = renderHook(() => useSessions(), {
        wrapper,
      });
      const { result: createSessionHook } = renderHook(
        () => useCreateSession(),
        { wrapper },
      );

      // Wait for initial data to load
      await waitFor(() => {
        expect(sessionsList.current.data).toEqual(initialSessions);
      });

      // Create new session
      await createSessionHook.current.createSession();

      // Wait for the list to update with the new session
      await waitFor(() => {
        expect(sessionsList.current.data).toEqual(updatedSessions);
      });

      // Verify the sequence of API calls
      expect(api.createSession).toHaveBeenCalledWith({
        apiUrl: mockConfig.apiUrl,
        apiKey: mockConfig.apiKey,
        did: mockConfig.config.did,
        matrixAccessToken: mockConfig.config.matrixAccessToken,
        oracleName: 'new-oracle',
      });

      expect(api.listSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe('useCreateSession', () => {
    it('should create a session', async () => {
      const mockSession = {
        sessionId: '1',
        oracleName: 'test',
        title: 'Test Session',
        lastUpdatedAt: '2024-02-14',
        createdAt: '2024-02-14',
      };

      jest.mocked(api.createSession).mockResolvedValue(mockSession);

      const { result } = renderHook(() => useCreateSession(), { wrapper });

      await result.current.createSession();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.createSession).toHaveBeenCalledWith({
        apiUrl: mockConfig.apiUrl,
        apiKey: mockConfig.apiKey,
        did: mockConfig.config.did,
        matrixAccessToken: mockConfig.config.matrixAccessToken,
        oracleName: 'test',
      });
    });
  });

  describe('useDeleteSession', () => {
    it('should delete a session', async () => {
      jest.mocked(api.deleteSession).mockResolvedValue();

      const { result } = renderHook(() => useDeleteSession(), { wrapper });

      await result.current.deleteSession({ sessionId: '1' });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.deleteSession).toHaveBeenCalledWith({
        apiUrl: mockConfig.apiUrl,
        apiKey: mockConfig.apiKey,
        did: mockConfig.config.did,
        matrixAccessToken: mockConfig.config.matrixAccessToken,
        sessionId: '1',
      });
    });
  });

  describe('useUpdateSessionTitle', () => {
    it('should update session title', async () => {
      jest.mocked(api.updateSessionTitle).mockResolvedValue();

      const { result } = renderHook(() => useUpdateSessionTitle(), { wrapper });

      await result.current.updateSessionTitle({
        sessionId: '1',
        title: 'New Title',
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(api.updateSessionTitle).toHaveBeenCalledWith({
        apiUrl: mockConfig.apiUrl,
        apiKey: mockConfig.apiKey,
        sessionId: '1',
        matrixAccessToken: mockConfig.config.matrixAccessToken,
        title: 'New Title',
      });
    });
  });
});
