import { type DeliverTxResponse } from '@cosmjs/stargate';
import {
  type ICreateVerifiableCredentialArgs,
  type VerifiableCredential,
} from '@veramo/core';
import { type AgentConfig } from './identity-agent.js';

export type Networks = 'devnet' | 'testnet' | 'mainnet';
export type * from '@veramo/core';

export interface IClaim {
  claimId: string;
  // Used for schema evaluation
  credentials?: VerifiableCredential;
}

export interface ISubmitClaimPayload {
  type: string; // schema type to validate against
  collectionId: string;
  claims: IClaim[];
}

export interface ICreateAndSubmitClaimPayload {
  type?: string; // schema type to validate against
  collectionId: string;
  storage: 'cellnode' | 'ipfs';
  // must provide either credentials or generate
  credential: ICreateVerifiableCredentialArgs;

  agentConfig: AgentConfig;
}

export interface ISubmitClaim {
  type: string; // schema type to validate against
  collectionId: string;
  claims: IClaim[];
}
export type CreateAndSubmitResponse = {
  claims: { claimId: string; credentials: VerifiableCredential }[];
} & DeliverTxResponse;

export enum AgentRoles {
  evaluators = 'EA',
  serviceProviders = 'SA',
}
