import { Authz } from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
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
  const {
    data: members,
    isLoading: isLoadingMembers,
    refetch: refetchMembers,
  } = useQuery({
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

  const inviteUserFn = useCallback(
    async (userId: string) => {
      const roomId =
        oracleRoomId ??
        (await matrixClientRef.getOracleRoomId({
          userDid: wallet?.did ?? '',
          oracleDid: `did:ixo:${authzConfig?.granteeAddress}`,
        }));
      if (!roomId) {
        throw new Error('Oracle room id not found');
      }
      await matrixClientRef.inviteUser(roomId, userId);
      await refetchMembers();
    },
    [oracleRoomId, authzConfig?.granteeAddress, wallet?.did],
  );

  const { mutateAsync: inviteUser, isPending: isInvitingUser } = useMutation({
    mutationFn: inviteUserFn,
  });

  const enableMemoryEngineFn = useCallback(
    async (memoryEngineUserId: string) => {
      const roomId =
        oracleRoomId ??
        (await matrixClientRef.getOracleRoomId({
          userDid: wallet?.did ?? '',
          oracleDid: `did:ixo:${authzConfig?.granteeAddress}`,
        }));
      if (!roomId) {
        throw new Error('Oracle room id not found');
      }
      await matrixClientRef.inviteUser(roomId, memoryEngineUserId);
      await matrixClientRef.setPowerLevel(roomId, memoryEngineUserId, 50);
      await refetchMembers();
    },
    [oracleRoomId, authzConfig?.granteeAddress, wallet?.did],
  );

  const { mutateAsync: enableMemoryEngine, isPending: isLoadingMemoryEngine } =
    useMutation({
      mutationFn: enableMemoryEngineFn,
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
