import { Authz, Payments } from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import MatrixClient from '../../matrix/matrix-client.js';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';

const payments = new Payments();

interface IUseContractOracleProps {
  params: {
    oracleDid: string;
    userClaimCollectionId: string;
    adminAddress: string;
    claimId: string;
    agentQuota?: number;
    maxAmount?: {
      amount: number;
      denom: string;
    };
  };
}

const useContractOracle = ({ params }: IUseContractOracleProps) => {
  const { wallet, transactSignX } = useOraclesContext();
  const matrixClientRef = useMemo(
    () =>
      new MatrixClient({
        userAccessToken: wallet?.matrix.accessToken ?? '',
      }),
    [wallet?.matrix.accessToken],
  );

  const { data: authzConfig, isLoading: isLoadingAuthzConfig } = useQuery({
    queryKey: ['authz-config', params.oracleDid],
    queryFn: async () => {
      const config = await Authz.getOracleAuthZConfig({
        oracleDid: params.oracleDid,
        granterAddress: wallet?.address ?? '',
      });
      return config;
    },
    enabled: Boolean(wallet?.address),
  });

  // Get pricing list
  const { data: pricingList, isLoading: isLoadingPricingList } = useQuery({
    queryKey: ['pricing-list', params.oracleDid],
    queryFn: async () => {
      const list = await payments.getOraclePricingList(params.oracleDid);
      return list;
    },
  });

  const { mutateAsync: contractOracle, isPending: isContractingOracle } =
    useMutation({
      mutationFn: async () => {
        const config =
          authzConfig ??
          (await Authz.getOracleAuthZConfig({
            oracleDid: params.oracleDid,
            granterAddress: wallet?.address ?? '',
          }));

        if (pricingList?.length === 0 && !params.maxAmount) {
          throw new Error(
            'No pricing list found please provide a max amount or add a pricing list to the oracle',
          );
        }

        const authz = new Authz(config);

        if (!wallet?.did || !wallet.matrix.accessToken) {
          throw new Error('Wallet or matrix access token not found');
        }

        const mainSpaceId = await matrixClientRef.sourceMainSpace({
          userDID: wallet.did,
        });

        await matrixClientRef.joinSpaceOrRoom({
          roomId: mainSpaceId,
        });

        await matrixClientRef.createAndJoinOracleRoom({
          oracleDID: `did:ixo:${config.granteeAddress}`,
          userDID: wallet.did,
        });

        return authz.contractOracle(
          {
            adminAddress: params.adminAddress,
            claimCollectionId: params.userClaimCollectionId,
            oracleAddress: config.granteeAddress,
            oracleName: config.oracleName,
            accountAddress: wallet.address,
            agentQuota: params.agentQuota ?? 1,
            maxAmount: params.maxAmount
              ? [
                  {
                    amount: params.maxAmount.amount.toString(),
                    denom: params.maxAmount.denom,
                  },
                ]
              : [
                  {
                    amount: pricingList?.[0]?.amount ?? '0',
                    denom: pricingList?.[0]?.denom ?? 'uixo',
                  },
                ],
          },
          transactSignX,
        );
      },
    });

  const { mutateAsync: payClaim, isPending: isPayingClaim } = useMutation({
    mutationFn: async () => {
      if (!wallet?.address) {
        throw new Error('Wallet not found');
      }
      await payments.payClaim({
        userAddress: wallet.address,
        claimId: params.claimId,
        adminAddress: params.adminAddress,
        claimCollectionId: params.userClaimCollectionId,
        sign: transactSignX,
      });
    },
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
    contractOracle,
    isContractingOracle,
    payClaim,
    isPayingClaim,
    isLoadingPricingList,
    pricingList,
    isLoadingAuthzConfig,
    authzConfig,
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

export default useContractOracle;
