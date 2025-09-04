import { Authz } from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import MatrixReactSdkClient from '../../matrix/matrix-client.js';

import { IOpenIDToken, MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { useOraclesConfig } from '../../hooks/use-oracles-config.js';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import createCallMxEvent from './helpers/create-call-mx-event.js';
import { ToastFn, useLiveKitAgent } from './livekit/use-livekit-agent.js';

export const useLiveAgent = (
  oracleDid: string,
  mxClient: MatrixClient,
  openIdToken: IOpenIDToken,
  toastAlert?: ToastFn,
) => {
  const { wallet, authedRequest } = useOraclesContext();

  const { config } = useOraclesConfig(oracleDid);
  const matrixClientRef = useMemo(
    () =>
      new MatrixReactSdkClient({
        userAccessToken: wallet?.matrix.accessToken ?? '',
      }),
    [wallet?.matrix.accessToken],
  );

  const { data: authzConfig } = useQuery({
    queryKey: ['authz-config', oracleDid],
    queryFn: async () => {
      const config = await Authz.getOracleAuthZConfig({
        oracleDid,
        granterAddress: wallet?.address ?? '',
      });
      return config;
    },
    enabled: Boolean(wallet?.address),
  });

  const { data: oracleRoomId } = useQuery({
    queryKey: ['oracle-room-id', authzConfig?.granteeAddress],
    queryFn: async () => {
      const roomId = await matrixClientRef.getOracleRoomId({
        userDid: wallet?.did ?? '',
        oracleDid: `did:ixo:${authzConfig?.granteeAddress}`,
      });
      return roomId;
    },
    enabled: Boolean(
      wallet?.did && authzConfig?.granteeAddress && wallet.matrix.accessToken,
    ),
  });

  const { startCall, ...liveKitAgent } = useLiveKitAgent(
    openIdToken,
    toastAlert,
  );
  const { mutateAsync: callAgent, isPending: isCalling } = useMutation({
    mutationFn: async ({
      callType,
      sessionId,
    }: {
      callType: 'audio' | 'video';
      sessionId: string;
    }) => {
      const { callId, encryptionKey } = await createCallMxEvent({
        oracleAccountDid: `did:ixo:${authzConfig?.granteeAddress}`,
        mxClient: mxClient,
        roomId: oracleRoomId ?? '',
        callType,
        sessionId,
      });

      await authedRequest(`${config.apiUrl}/calls/${callId}/sync`, 'POST', {
        openIdToken: openIdToken?.access_token,
      });

      startCall({
        callId,
        encryptionKey,
      });
      return { callId, encryptionKey };
    },
  });

  return {
    ...liveKitAgent,
    isCalling,
    callAgent,
  };
};
