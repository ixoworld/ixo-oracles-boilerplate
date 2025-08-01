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
        (service: Service) =>
          service.type === 'oracleService' || service.id === '{id}#api',
      ) as Service | undefined;
      if (!url) {
        if (overrides?.baseUrl) {
          return overrides.baseUrl;
        }
        return null;
      }
      // validate url
      try {
        const urlObj = new URL(url.serviceEndpoint);
        return urlObj.origin;
      } catch (error) {
        console.error(error, url);
        throw new Error(`Invalid url: ${url.serviceEndpoint}`, {
          cause: error,
        });
      }
    }
    return null;
  }, [data?.service]);

  const socketUrl = useMemo(() => {
    if (!data?.service) return null;
    if (Array.isArray(data.service)) {
      const service = data.service.find(
        (s: Service) => s.type === 'wsService' || s.id === '{id}#ws',
      ) as Service | undefined;
      if (!service) return null;
      try {
        const urlObj = new URL(service.serviceEndpoint);
        return urlObj.origin;
      } catch (error) {
        console.error(error, service);
        return null;
      }
    }
  }, [data?.service]);

  return {
    config: {
      authConfig,
      apiUrl,
      socketUrl,
    },
    isLoading,
  };
};
