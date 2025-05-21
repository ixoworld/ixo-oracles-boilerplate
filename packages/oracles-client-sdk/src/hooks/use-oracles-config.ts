import { useOraclesContext } from '../providers/oracles-provider/oracles-context.js';

import { Authz, gqlClient } from '@ixo/oracles-chain-client/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

type Service = {
  type: string;
  serviceEndpoint: string;
  id: string;
};

export const useOraclesConfig = (
  oracleId: string,
  overrides?: {
    baseUrl?: string;
  },
) => {
  const { wallet } = useOraclesContext();

  const { data, isLoading } = useQuery({
    queryKey: ['oracles-config', oracleId],
    queryFn: async () => {
      const res = await gqlClient.GetEntityById({ id: oracleId });
      return res.entity;
    },
  });

  const { data: authConfig } = useQuery({
    queryKey: ['oracles-config', oracleId, 'authConfig'],
    queryFn: () =>
      Authz.getOracleAuthZConfig({
        oracleDid: oracleId,
        granterAddress: wallet?.address ?? '',
      }),
    enabled: Boolean(wallet?.address),
  });

  const apiUrl = useMemo(() => {
    if (!data?.service) return null;
    if (Array.isArray(data.service)) {
      const url = data.service.find(
        (service: Service) => service.type === 'oracleService',
      ) as Service | undefined;
      if (!url) {
        if (overrides?.baseUrl) {
          return overrides.baseUrl;
        }
        return null;
      }
      // validate url
      try {
        // eslint-disable-next-line no-new -- url is validated
        new URL(url.serviceEndpoint);
        return url.serviceEndpoint;
      } catch (error) {
        console.error(error);
        console.log(url);
        throw new Error(`Invalid url: ${url.serviceEndpoint}`, {
          cause: error,
        });
      }
    }
    return null;
  }, [data?.service]);

  return {
    config: {
      authConfig,
      apiUrl,
    },
    isLoading,
  };
};
