import { LinkedResource } from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types.js';
import { gqlClient } from 'src/gql/index.js';
import { TGetSettingsResourceSchema } from '../client/entities/types.js';

export async function getSettingsResource<T>(
  settingsResourceParams: TGetSettingsResourceSchema,
  matrixAccessToken?: string,
): Promise<T> {
  const protocol = (
    await gqlClient.GetEntityById({ id: settingsResourceParams.protocolDid })
  )?.entity;
  if (!protocol) {
    throw new Error(
      'Protocol not found with did: ' + settingsResourceParams.protocolDid,
    );
  }
  const settingsResource = protocol?.linkedResource as LinkedResource[];
  const resource = settingsResource.find(
    (resource) => resource.id === settingsResourceParams.id || resource.type === settingsResourceParams.type,
  );
  if (!resource) {
    throw new Error('Resource not found');
  }

  const url = resource.serviceEndpoint;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${matrixAccessToken}`,
    },
  });
  const data = await response.json();
  return data as T;
}
