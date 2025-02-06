import 'dotenv/config';

import axios from 'axios';
import {
  type IClaimCollectionQueryResponse,
  type IEntityQueryResponse,
  type IIdDoc,
} from './types';

const request = async <T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  if (!process.env.BLOCKSYNC_GRAPHQL_URL) {
    throw new Error('BLOCKSYNC_GRAPHQL_URL is not set');
  }
  const response = await axios.post<{
    data: Record<string, unknown>;
  }>(process.env.BLOCKSYNC_GRAPHQL_URL, {
    query,
    variables,
  });
  return response.data.data as T;
};

const QUERY_ENTITY_BY_ID = `
  query entityById($entityId: String!) {
    entities(filter: { id: { equalTo: $entityId } }) {
      nodes {
        id
        externalId
        accounts
        context
        iidById {
          service
          linkedResource
        }
      }
    }
  }
`;
export const queryEntityById = async (entityId: string) => {
  const data = await request<IEntityQueryResponse>(QUERY_ENTITY_BY_ID, {
    entityId,
  });
  return data.entities?.nodes?.[0];
};

const QUERY_CLAIM_COLLECTION_BY_ID = `
  query claimCollectionById($collectionId: String!) {
    claimCollections(filter: { id: { equalTo: $collectionId } }) {
      nodes {
        admin
        id
        approved
        disputed
        count
        endDate
        entity
        evaluated
        nodeId
        payments
        protocol
        quota
        rejected
        startDate
        state
      }
    }
  }
`;
export const queryClaimCollectionById = async (collectionId: string) => {
  const data = await request<IClaimCollectionQueryResponse>(
    QUERY_CLAIM_COLLECTION_BY_ID,
    {
      collectionId,
    },
  );
  return data.claimCollections?.nodes?.[0];
};

export async function hasAuthzSAClaims(
  userDid: string,
  collectionId: string,
): Promise<boolean> {
  const idDoc = await request<IIdDoc>(
    `query Iid {
    iid(id: "${userDid}") {
        linkedResource
    }
}`,
    {},
  );

  const offer = idDoc.iid.linkedResource.some(
    (item) =>
      item.id === `{id}#offer#${collectionId}` &&
      item.type === 'DeedOffer' &&
      item.description.includes(`${collectionId}#SA`),
  );

  return offer;
}
