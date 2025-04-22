import { Authz } from '@ixo/oracles-chain-client';
import { z } from 'zod';

const contractOracleSchema = z.object({
  oracleDid: z.string(),
  granterAddress: z.string(),
  claimCollection: z.string().optional(),
});

export const checkIfOracleHasClaimSubmitAuthorization = async (
  payload: z.infer<typeof contractOracleSchema>,
): Promise<boolean> => {
  const config = await Authz.getOracleAuthZConfig(payload);
  const authz = new Authz(config);
  const hasPermission = await authz.hasPermission(
    '/ixo.claims.v1beta1.SubmitClaimAuthorization',
  );
  return hasPermission;
};
