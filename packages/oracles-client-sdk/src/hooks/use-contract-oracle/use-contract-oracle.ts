import {
  Authz,
  type IAuthzConfig,
  Payments,
} from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';

const payments = new Payments();

interface IUseContractOracleProps {
  params: {
    oracleDid: string;
    userClaimCollectionId: string;
    adminAddress: string;
    claimId: string;
    maxAmount?: number;
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

  const { mutateAsync: contractOracle, isPending: isContractingOracle } =
    useMutation({
      mutationFn: (overrideAuthzConfig?: IAuthzConfig) => {
        const config = overrideAuthzConfig ?? authzConfig;
        if (!config) {
          throw new Error('Authz config not found');
        }

        const authz = new Authz(config);
        return authz.contractOracle(
          {
            adminAddress: params.adminAddress,
            claimCollectionId: params.userClaimCollectionId,
            granteeAddress: params.oracleDid,
            granterAddress: wallet?.address ?? '',
            oracleName: config.oracleName,
            maxAmount: params.maxAmount,
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

    isLoadingAuthzConfig,
    authzConfig,
  };
};

export default useContractOracle;
