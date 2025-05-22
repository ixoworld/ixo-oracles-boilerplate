import { Authz, Payments } from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
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

  const { data: authzConfig, isLoading: isLoadingAuthzConfig } = useQuery({
    queryKey: ['authz-config', params.oracleDid],
    queryFn: async () => {
      return Authz.getOracleAuthZConfig({
        oracleDid: params.oracleDid,
        granterAddress: wallet?.address ?? '',
      });
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
        return authz.contractOracle(
          {
            adminAddress: params.adminAddress,
            claimCollectionId: params.userClaimCollectionId,
            oracleAddress: config.granteeAddress,
            oracleName: config.oracleName,
            accountAddress: wallet?.address ?? '',
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
                    amount: pricingList?.[0]?.amount.amount ?? '0',
                    denom: pricingList?.[0]?.amount.denom ?? 'uixo',
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

  return {
    contractOracle,
    isContractingOracle,
    payClaim,
    isPayingClaim,
    isLoadingPricingList,
    pricingList,
    isLoadingAuthzConfig,
    authzConfig,
  };
};

export default useContractOracle;
