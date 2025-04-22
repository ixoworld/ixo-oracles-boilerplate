'use client';

import { useContractOracle } from '@ixo/oracles-client-sdk';
import { Button } from '@mantine/core';

export default function Payments() {
  const {
    pay,
    isPaying,
    checkForActiveIntent,
    hasActiveIntent,
    isCheckingActiveIntent,
    outstandingPayments,
    contractOracle,
    isContractingOracle,
    authzConfig,
  } = useContractOracle('did:ixo:entity:27d36161eb4c90a9d49fa867eccc86a1', {
    baseUrl: 'http://localhost:4200',
  });

  return (
    <div>
      <div>{JSON.stringify({ authzConfig })}</div>
      <div>{JSON.stringify(outstandingPayments)}</div>
      <Button disabled={isPaying} onClick={() => pay()}>
        Pay Intent
      </Button>
      <Button
        disabled={isContractingOracle}
        onClick={() =>
          contractOracle({
            granteeAddress: 'ixo1z7l9xgptzleqqrll54mqnlt2e4ajp2g5e8unkg',
            oracleName: 'Domain Oracle',
            requiredPermissions: [
              '/ixo.claims.v1beta1.SubmitClaimAuthorization',
              '/ixo.entity.v1beta1.MsgCreateEntity',
            ],
            granterAddress: 'ixo1xpww6379u29ydvh54vmn6na2eyxyp8rk7fsrr0',
          })
        }
      >
        Contract Oracle
      </Button>
    </div>
  );
}
