import { LinkedResource } from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types.js';
import { gqlClient } from 'src/gql/index.js';
import { MatrixBotService } from 'src/matrix-bot/matrix-bot.service.js';
import { TGetSettingsResourceSchema } from '../client/entities/types.js';

export async function getSettingsResource<T>(
  settingsResourceParams: TGetSettingsResourceSchema,
  matrixAccessToken?: string,
): Promise<T> {
  const matrixBotService = new MatrixBotService(matrixAccessToken);

  const protocol = (
    await gqlClient.GetEntityById({ id: settingsResourceParams.protocolDid })
  )?.entity;
  if (!protocol) {
    throw new Error(
      'Protocol not found with did: ' + settingsResourceParams.protocolDid,
    );
  }
  const settingsResource = protocol?.settings?.[settingsResourceParams.key];
  if (!settingsResource) {
    // try using old implementation
    const linkedResource = Array.isArray(protocol?.linkedResource)
      ? protocol?.linkedResource
      : [];

    const resource = (await getResourceFromIpfs(
      linkedResource,
      settingsResourceParams.key,
    )) as T;
    if (!resource) {
      throw new Error(
        `Settings resource not found for key ${settingsResourceParams.key}`,
      );
    }
    return resource;
  }
  const roomId = await matrixBotService.getRoomIdFromAlias(protocol.id);
  const matrixValue = await matrixBotService.get<T>(
    roomId,
    'resources',
    settingsResource.proof,
  );

  return matrixValue as T;
}
const getResourceFromIpfs = async (
  linkedResource: LinkedResource[],
  key: string,
) => {
  const resource = linkedResource.find(
    (resource) => resource.description === key,
  );
  if (!resource) {
    throw new Error('Resource not found');
  }

  if (resource.serviceEndpoint.includes('ipfs.w3s.link')) {
    const response = await fetch(resource.serviceEndpoint);
    const data = await response.json();
    return data;
  }

  return null;
};
