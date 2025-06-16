import { ixo, utils } from '@ixo/impactxclient-sdk';
import { gqlClient } from '../../gql/index.js';
import { getSettingsResource } from '../../utils/get-settings-resouce.js';
import type { Client } from '../client.js';
import { CreateEntityParams, TGetSettingsResourceSchema } from './types.js';

export class Entities {
  constructor(public readonly client: Client) {}

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

  static async getEntityIdByClaimCollectionId(claimCollectionId: string) {
    const entity = await gqlClient.GetEntityIdByClaimCollectionId({
      claimCollectionId,
    });
    const id = entity.claimCollection?.entityId;
    if (!id) {
      throw new Error('Entity ID not found');
    }
    return Entities.getEntityById(id);
  }

  static async getEntityByType(type: string) {
    const entity = await gqlClient.GetEntityByType({ type });
    return entity.entities?.nodes;
  }

  static async getSettingsResource<T>(
    settingsResourceParams: TGetSettingsResourceSchema,
    matrixAccessToken?: string,
  ): Promise<T> {
    return getSettingsResource<T>(settingsResourceParams, matrixAccessToken);
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

  /**
   * @description Create an entity on the chain
   * @param value - The message to create an entity
   * @returns The did of the entity
   *
   * This function is used to create an entity on the chain via HTTP POST request
   * @example - On the client side
   * const messageValue = ixo.entity.v1beta1.MsgCreateEntity.fromPartial({...})
   * const entityAsBuffer = ixo.entity.v1beta1.MsgCreateEntity.encode(messageValue).finish()
   *
   * Then a post request to the server with this Buffer
   * @example - On the server side
   * const message = req.body.message;
   * const buffer = Buffer.from(message);
   * const decodedMessage = ixo.entity.v1beta1.MsgCreateEntity.decode(buffer); // decodedMessage is the same as messageValue and it's ready to be used to create an entity on the chain
   */
  public async create(value: CreateEntityParams): Promise<string> {
    const buffer = Buffer.from(value);
    const decodedMessage = ixo.entity.v1beta1.MsgCreateEntity.decode(buffer);
    const did = await this.client.runWithInitiatedClient(async (client) => {
      const txRes = await client.signAndBroadcast([
        {
          typeUrl: '/ixo.entity.v1beta1.MsgCreateEntity',
          value: decodedMessage,
        },
      ]);

      return utils.common.getValueFromEvents(txRes, 'wasm', 'token_id');
    });
    return did;
  }

  static async getClaimCollection(claimCollectionId: string) {
    const claimCollection = await gqlClient.getClaimCollection({
      claimCollectionId,
    });
    return claimCollection.claimCollection;
  }
}
