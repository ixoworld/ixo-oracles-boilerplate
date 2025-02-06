export interface IAccount {
  name: string;
  address: string;
}

export interface IContext {
  key: string;
  val: string;
}

export interface ILinkedResource {
  id: string;
  type: string;
  proof: string;
  right: string;
  encrypted: string;
  mediaType: string;
  description: string;
  serviceEndpoint: string;
}

export interface IIidById {
  service: unknown[];
  linkedResource: ILinkedResource[];
}

export interface IEntity {
  id: string;
  externalId: string;
  accounts: IAccount[];
  context: IContext[];
  iidById: IIidById;
}

export interface IEntityQueryResponse {
  entities?: {
    nodes?: IEntity[];
  };
}

export interface IAmount {
  denom: string;
  amount: string;
}

type IContract1155Payment = object;

export interface IPaymentDetails {
  amount: IAmount[];
  account: string;
  timeout_ns: string;
  cw20_payment: unknown[];
  is_oracle_payment: boolean;
  contract_1155_payment: IContract1155Payment | null;
}

export interface IPayments {
  approval: IPaymentDetails;
  rejection: IPaymentDetails;
  evaluation: IPaymentDetails;
  submission: IPaymentDetails;
}

export interface IClaimCollection {
  admin: string;
  id: string;
  approved: number;
  disputed: number;
  count: number;
  endDate: string;
  entity: string;
  evaluated: number;
  nodeId: string;
  payments: IPayments;
  protocol: string;
  quota: number;
  rejected: number;
  startDate: string;
  state: number;
}

export interface IClaimCollectionQueryResponse {
  claimCollections?: {
    nodes?: IClaimCollection[];
  };
}

export interface IIdDoc {
  iid: {
    linkedResource: ILinkedResource[];
  };
}
