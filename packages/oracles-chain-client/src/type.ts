export type Networks = 'devnet' | 'testnet' | 'mainnet';

export interface ISubmitClaimPayload {
  type: string; // schema type to validate against
  collectionId: string;
}

export interface ISubmitClaim {
  type: string; // schema type to validate against
  collectionId: string;
}

export enum AgentRoles {
  evaluators = 'EA',
  serviceProviders = 'SA',
}
