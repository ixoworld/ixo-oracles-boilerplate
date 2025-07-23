import { Authz } from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import MatrixClient from '../matrix/matrix-client.js';
import { useOraclesContext } from '../providers/oracles-provider/oracles-context.js';

export const useMemoryEngine = (oracleDid: string) => {
  const { wallet } = useOraclesContext();
  const matrixClientRef = useMemo(
    () =>
      new MatrixClient({
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

  const { data: oracleRoomId, isLoading: isLoadingOracleRoomId } = useQuery({
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

  // list members in a room
  const { data: members, isLoading: isLoadingMembers } = useQuery({
    queryKey: ['members', authzConfig?.granteeAddress],
    queryFn: async () => {
      if (!oracleRoomId) {
        return [];
      }
      const m = await matrixClientRef.listRoomMembers(oracleRoomId);
      return m;
    },
    enabled: Boolean(oracleRoomId),
  });

  const { mutateAsync: inviteUser, isPending: isInvitingUser } = useMutation({
    mutationFn: async (userId: string) => {
      if (!oracleRoomId) {
        throw new Error('Oracle room id not found');
      }
      await matrixClientRef.inviteUser(oracleRoomId, userId);
    },
  });

  const { mutateAsync: enableMemoryEngine, isPending: isLoadingMemoryEngine } =
    useMutation({
      mutationFn: async (memoryEngineUserId: string) => {
        if (!oracleRoomId) {
          throw new Error('Oracle room id not found');
        }
        await matrixClientRef.inviteUser(oracleRoomId, memoryEngineUserId);
        await matrixClientRef.setPowerLevel(
          oracleRoomId,
          memoryEngineUserId,
          50,
        );
      },
    });

  return {
    inviteUser,
    isInvitingUser,
    isLoadingOracleRoomId,
    oracleRoomId,
    isLoadingMembers,
    members,
    enableMemoryEngine,
    isLoadingMemoryEngine,
  };
};
