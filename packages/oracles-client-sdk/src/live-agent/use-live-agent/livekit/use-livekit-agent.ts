import {
  DeviceUnsupportedError,
  ExternalE2EEKeyProvider,
  Room,
  RoomEvent,
} from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { IOpenIDToken } from 'matrix-js-sdk';
import useConnectionDetails from './use-connection-details.js';

export type ToastFn = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => void;
const fakeToast: ToastFn = ({ title, description }) => {
  console.log(title, description);
};

export function useLiveKitAgent(
  idToken: IOpenIDToken,
  toastAlert: ToastFn = fakeToast,
) {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionViewVisible, setSessionViewVisible] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Use ref to store current call info without causing re-renders
  const currentCallRef = useRef<{
    callId: string;
    encryptionKey: string;
  } | null>(null);

  const keyProvider = useMemo(() => new ExternalE2EEKeyProvider(), []);

  const worker: Worker | undefined = useMemo(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return new Worker(new URL('livekit-client/e2ee-worker', import.meta.url));
  }, []);

  const roomOptions = useMemo(() => {
    return {
      e2ee: worker ? { keyProvider, worker } : undefined,
      adaptiveStream: true,
      dynacast: true,
    };
  }, [keyProvider, worker]);

  const room = useMemo(() => new Room(roomOptions), [roomOptions]);

  const { refreshConnectionDetails, existingOrRefreshConnectionDetails } =
    useConnectionDetails();

  // Setup event listeners - useEffect is needed for proper cleanup on unmount
  useEffect(() => {
    const onDisconnected = () => {
      setSessionStarted(false);
      setSessionViewVisible(false);
      setIsConnecting(false);
      // Use the ref to get current call info
      if (currentCallRef.current?.callId) {
        refreshConnectionDetails(currentCallRef.current.callId, idToken);
      }
    };

    const onMediaDevicesError = (error: Error) => {
      toastAlert({
        title: 'Encountered an error with your media devices',
        description: `${error.name}: ${error.message}`,
      });
    };

    const onEncryptionError = (error: Error) => {
      console.error('Encryption error:', error);
      toastAlert({
        title: 'Encryption error',
        description: `${error.name}: ${error.message}`,
      });
    };

    const onConnected = () => {
      setSessionViewVisible(true);
      setIsConnecting(false);
    };

    // Set up event listeners
    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.EncryptionError, onEncryptionError);
    room.on(RoomEvent.Connected, onConnected);

    // Cleanup function - this is why we need useEffect!
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
      room.off(RoomEvent.EncryptionError, onEncryptionError);
      room.off(RoomEvent.Connected, onConnected);
    };
  }, [room, refreshConnectionDetails, idToken, toastAlert]);

  // Public API
  const startCall = useCallback(
    async ({
      callId,
      encryptionKey,
    }: {
      callId: string;
      encryptionKey: string;
    }) => {
      if (!callId) {
        throw new Error('Call ID is required');
      }
      if (!encryptionKey) {
        throw new Error('Encryption key is required');
      }

      try {
        // Store call params in ref (no re-render)
        currentCallRef.current = { callId, encryptionKey };

        setSessionStarted(true);
        setIsConnecting(true);

        // E2EE setup
        console.debug('Setting up E2EE with key');
        await keyProvider.setKey(encryptionKey);
        await room.setE2EEEnabled(true);

        // Get connection details
        const connectionDetails = await existingOrRefreshConnectionDetails(
          callId,
          idToken,
        );
        if (!connectionDetails) {
          throw new Error('Connection details not found');
        }

        // Connect to room
        console.debug('Connecting to room', { callId, encryptionKey });
        await room.prepareConnection(
          connectionDetails.url,
          connectionDetails.jwt,
        );
        await room.connect(connectionDetails.url, connectionDetails.jwt);
        console.debug('Connected to room', room);

        try {
          // Set up microphone
          const initialSelection = localStorage.getItem(
            `${'audioinput'}_device_id`,
          );
          await room.localParticipant.setMicrophoneEnabled(
            true,
            {
              deviceId: initialSelection ?? undefined,
            },
            {
              preConnectBuffer: true,
            },
          );
        } catch (error) {
          console.error('Error setting up microphone:', error);
        }

        return;
      } catch (error) {
        console.error('Start call error:', error);
        setIsConnecting(false);
        setSessionStarted(false);
        setSessionViewVisible(false);
        currentCallRef.current = null;

        if (error instanceof DeviceUnsupportedError) {
          toastAlert({
            title: 'E2EE Not Supported',
            description:
              'Your browser does not support E2EE. Please update to the latest version and try again.',
          });
        } else {
          toastAlert({
            title: 'Connection Error',
            description: `Failed to start call: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        throw error;
      }
    },
    [
      keyProvider,
      room,
      existingOrRefreshConnectionDetails,
      idToken,
      toastAlert,
    ],
  );

  const endCall = useCallback(() => {
    setSessionStarted(false);
    setSessionViewVisible(false);
    setIsConnecting(false);
    currentCallRef.current = null;
    room.disconnect();
  }, [room]);

  return {
    room,
    sessionStarted,
    sessionViewVisible,
    startCall,
    endCall,
    isConnecting,
    isReady: sessionViewVisible,
  };
}
