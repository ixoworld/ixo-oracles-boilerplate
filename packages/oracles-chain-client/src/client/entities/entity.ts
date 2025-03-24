import { utils } from '@ixo/impactxclient-sdk';
import { MatrixBotService } from '../../matrix-bot/matrix-bot.service.js';
import { gqlClient } from '../../gql/index.js';
import Client from '../client.js';
import {
  TGetSettingsResourceSchema,
  TGetSurveyJsDomainSchema,
} from './create-entity/types.js';

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
    matrixAccessToken?: string,
  ) {
    return await this.getSettingsResource(
      {
        protocolDid: domainParams.protocolDid,
        key: 'DomainSettingsTemplate',
      },
      matrixAccessToken,
    );
  }

  static async getSettingsResource(
    settingsResourceParams: TGetSettingsResourceSchema,
    matrixAccessToken?: string,
  ) {
    const matrixBotService = new MatrixBotService(matrixAccessToken);
    const protocol = await Entities.getEntityById(
      settingsResourceParams.protocolDid,
    );
    if (!protocol) {
      throw new Error('Protocol not found');
    }
    const settingsResource = protocol?.settings?.[settingsResourceParams.key];
    if (!settingsResource) {
      throw new Error(
        `Settings resource not found for key ${settingsResourceParams.key}`,
      );
    }
    const roomId = await matrixBotService.getRoomIdFromAlias(protocol.id);
    const matrixValue = await matrixBotService.get(
      roomId,
      'resources',
      settingsResource.proof,
    );

    return matrixValue;
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
