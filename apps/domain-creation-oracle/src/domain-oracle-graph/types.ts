interface IProtocol {
  name: string;
  description: string;
  did: string;
}

export enum GraphNodes {
  DomainCreationOracle = 'domain-creation-oracle',
  GenericChat = 'generic-chat',
  Tools = 'tools',
  ToolsChat = 'tools-chat',
}

export type { IProtocol };
