// import type { IAuthzConfig } from '@ixo/oracles-chain-client';
import { type IAuthzConfig, Payments } from '@ixo/oracles-chain-client';
import { Authz } from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { useOraclesConfig } from '../use-oracles-config.js';

const payments = new Payments();

interface IUseContractOracleProps {
  params: {
    oracleDid: string;
    userClaimCollectionId: string;
    adminAddress: string;
    claimId: string;
    maxAmount?: number;
  };
  overrides?: {
    baseUrl?: string;
  };
}

const useContractOracle = ({ params, overrides }: IUseContractOracleProps) => {
  const { wallet, transactSignX } = useOraclesContext();
  const { config } = useOraclesConfig(params.oracleDid);

  const apiUrl = overrides?.baseUrl ?? config.apiUrl;
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

  const {
    mutateAsync: checkForActiveIntent,
    data: hasActiveIntent,
    isPending: isCheckingActiveIntent,
  } = useMutation({
    mutationFn: async () => {
      if (!wallet?.address) {
        throw new Error('Wallet not found');
      }
      if (!apiUrl) {
        throw new Error('API URL not found');
      }

      const activeIntent = await payments.checkForActiveIntent({
        userAddress: wallet.address,
        granteeAddress: params.oracleDid,
        userClaimCollection: params.userClaimCollectionId,
      });

      return activeIntent;
    },
  });

  const {
    data: outstandingPayments,
    isPending: isCheckingOutstandingPayments,
  } = useQuery({
    queryKey: ['outstanding-payments', wallet?.address],
    queryFn: async () => {
      if (!wallet?.address) {
        throw new Error('Wallet not found');
      }
      if (!apiUrl) {
        throw new Error('API URL not found');
      }
      const addressFromDid = params.oracleDid.split('did:ixo:')[1];
      if (!addressFromDid) {
        throw new Error('Oracle DID not found');
      }
      const outstandingClaims = await payments.getOutstandingPayments({
        oracleAddress: addressFromDid,
        userAddress: wallet.address,
        userClaimCollection: params.userClaimCollectionId,
      });

      return outstandingClaims;
    },
  });

  return {
    contractOracle,
    isContractingOracle,
    payClaim,
    isPayingClaim,
    checkForActiveIntent,
    hasActiveIntent,
    isCheckingActiveIntent,
    outstandingPayments,
    isCheckingOutstandingPayments,
    isLoadingAuthzConfig,
    authzConfig,
  };
};

export default useContractOracle;
