import { utils } from '@ixo/impactxclient-sdk';
import { gqlClient } from '../../gql/index.js';
import Client from '../client.js';
import { TGetSurveyJsDomainSchema } from './create-entity/types.js';
export class Entities {
  constructor(public readonly client = Client) {}
  static async getEntityById(entityId: string) {
    const entity = await gqlClient.GetEntityById({ id: entityId });
    return entity.entity;
  }

  static async getEntitiesByOwnerAddress(ownerAddress: string) {
    const entities = await gqlClient.GetEntitiesByOwnerAddress({
      ownerAddress,
    });
    return entities.entities?.nodes;
  }

  static async getEntityByType(type: string) {
    const entity = await gqlClient.GetEntityByType({ type });
    return entity.entities?.nodes;
  }

  static async getSurveyJsDomain(
    domainParams: TGetSurveyJsDomainSchema,
    matrixBotService: MatrixBotService,
  ) {
    const protocol = await Entities.getEntityById(domainParams.protocolDid);

    if (!protocol) {
      throw new Error('Protocol not found');
    }

    const settingsResource = protocol?.settings?.DomainSettingsTemplate;
    if (!settingsResource) {
      throw new Error('Settings resource not found');
    }
    const roomId = await matrixBotService.getRoomIdFromAlias(protocol.id);

    const matrixValue = await matrixBotService.get<
      Array<{
        data: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }>
    >(roomId, 'resources', settingsResource.proof);

    if (!Array.isArray(matrixValue)) {
      throw new Error(
        'MATRIX INTERNAL ERROR: The matrix value is not an array - The MCP service expects the State to matrix state Value to be an array of {data: Record<string, unknown>, metadata: Record<string, unknown>} in the first index for key "resources" and path settingsResource.proof',
      );
    }
    return matrixValue[0]?.data;
  }

  public async getEntityIdFromTx(txHash: string): Promise<string | undefined> {
    const tx = await this.client.getTxByHash(txHash);
    if (!tx) {
      throw new Error('Tx not found');
    }

    // the function only needs the events array
    const did = utils.common.getValueFromEvents(
      {
        events: tx.events,
      } as any,
      'wasm',
      'token_id',
    );
    return did;
  }

  static instance = new Entities();
}

interface MatrixBotService {
  getRoomIdFromAlias(alias: string): Promise<string>;
  get<T>(
    roomId: string,
    key: string,
    path?: string,
  ): Promise<T | Record<string, T>>;
}
