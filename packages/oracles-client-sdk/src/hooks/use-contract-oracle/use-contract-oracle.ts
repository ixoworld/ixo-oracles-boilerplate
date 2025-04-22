// import type { IAuthzConfig } from '@ixo/oracles-chain-client';
import { Authz } from '@ixo/oracles-chain-client/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOraclesContext } from '../../providers/oracles-provider/oracles-context.js';
import { useOraclesConfig } from '../use-oracles-config.js';

const useContractOracle = (
  oracleDid: string,
  overrides?: {
    baseUrl?: string;
  },
) => {
  const { wallet, authedRequest, transactSignX } = useOraclesContext();
  const { config } = useOraclesConfig(oracleDid);

  const apiUrl = overrides?.baseUrl ?? config.apiUrl;
  const { data: authzConfig, isLoading: isLoadingAuthzConfig } = useQuery({
    queryKey: ['authz-config', oracleDid],
    queryFn: async () => {
      const authzConfig = await Authz.getOracleAuthZConfig({
        oracleDid,
        granterAddress: wallet?.address ?? '',
      });
      return authzConfig;
    },
    enabled: !!wallet?.address,
  });

  const { mutateAsync: contractOracle, isPending: isContractingOracle } =
    useMutation({
      mutationFn: (overrideAuthzConfig?: any) => {
        const config = overrideAuthzConfig ?? authzConfig;
        if (!config) {
          throw new Error('Authz config not found');
        }

        const authz = new Authz(config);
        return authz.contractOracle(transactSignX);
      },
    });

  const { mutateAsync: pay, isPending: isPaying } = useMutation({
    mutationFn: async () => {
      if (!wallet?.address) {
        throw new Error('Wallet not found');
      }

      await authedRequest<void>(`${apiUrl}/payments/pay`, 'POST', {
        body: JSON.stringify({
          userAddress: wallet.address,
        }),
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

      const response = await authedRequest<{
        activeIntent: boolean;
      }>(`${apiUrl}/payments/intent/status`, 'POST', {
        body: JSON.stringify({
          userAddress: wallet.address,
        }),
      });

      return response.activeIntent;
    },
  });

  const {
    data: outstandingPayments,
    isPending: isCheckingOutstandingPayments,
  } = useQuery({
    queryKey: ['outstanding-payments', wallet?.address],
    queryFn: () => {
      if (!wallet?.address) {
        throw new Error('Wallet not found');
      }
      if (!apiUrl) {
        throw new Error('API URL not found');
      }
      return authedRequest<{
        outstanding: string[];
      }>(`${apiUrl}/payments/outstanding/${wallet.address}`, 'GET');
    },
  });

  return {
    contractOracle,
    isContractingOracle,
    pay,
    isPaying,
    checkForActiveIntent,
    hasActiveIntent,
    isCheckingActiveIntent,
    outstandingPayments,
    isLoadingAuthzConfig,
    authzConfig,
  };
};

export default useContractOracle;
