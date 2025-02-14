import 'dotenv/config';

import axios from 'axios';

const request = async (
  url: string,
  query: string,
  variables: Record<string, unknown>,
) => {
  const response = await axios.post<{
    data: Record<string, any>;
  }>(url, {
    query,
    variables,
  });
  return response.data.data;
};

const BLOCKSYNC_GRAPHQL_URL = process.env.BLOCKSYNC_GRAPHQL_URL || '';

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
  const data: any = await request(BLOCKSYNC_GRAPHQL_URL, QUERY_ENTITY_BY_ID, {
    entityId,
  });
  return data?.entities?.nodes?.[0] ?? undefined;
};

const QUERY_ENTITY_BY_EXTERNAL_ID = `
  query entityById($externalId: String!) {
    entities(filter: { externalId: { equalTo: $externalId } }) {
      nodes {
        id
      }
    }
  }
`;
export const queryEntityByExternalId = async (externalId: string) => {
  const data: any = await request(
    BLOCKSYNC_GRAPHQL_URL,
    QUERY_ENTITY_BY_EXTERNAL_ID,
    {
      externalId,
    },
  );
  return data?.entities?.nodes?.[0] ?? undefined;
};

const QUERY_TOKENCLASS_BY_NAME = `
  query entityById($name: String!) {
    tokenClasses(filter: { name: { equalTo: $name } }) {
      nodes {
        contractAddress
      }
    }
  }
`;
export const queryTokenClassByName = async (name: string) => {
  const data: any = await request(
    BLOCKSYNC_GRAPHQL_URL,
    QUERY_TOKENCLASS_BY_NAME,
    {
      name,
    },
  );
  return data?.tokenClasses?.nodes?.[0] ?? undefined;
};

const QUERY_CLAIMCOLLECTION_BY_ID = `
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
  const data: any = await request(
    BLOCKSYNC_GRAPHQL_URL,
    QUERY_CLAIMCOLLECTION_BY_ID,
    {
      collectionId,
    },
  );
  return data?.claimCollections?.nodes?.[0] ?? undefined;
};

const QUERY_CLAIM_BY_ID = `
  query claimById($claimId: String!) {
    claims(filter: { claimId: { equalTo: $claimId } }) {
      nodes {
        claimId
        collectionId
        schemaType
        submissionDate
        evaluationByClaimId {
          verificationProof
          status
        }
      }
    }
  }
`;
export const queryClaimById = async (claimId: string) => {
  const data: any = await request(BLOCKSYNC_GRAPHQL_URL, QUERY_CLAIM_BY_ID, {
    claimId,
  });
  return data?.claims?.nodes?.[0] ?? undefined;
};

const QUERY_COLLECTION_CLAIMS = `
  query claimById($claimId: String!) {
    claims(filter: { claimId: { equalTo: $claimId } }) {
      nodes {
        claimId
        collectionId
        schemaType
        submissionDate
        evaluationByClaimId {
          verificationProof
          status
        }
      }
    }
  }
`;
export const queryCollectionClaims = async (claimId: string) => {
  const data: any = await request(
    BLOCKSYNC_GRAPHQL_URL,
    QUERY_COLLECTION_CLAIMS,
    {
      claimId,
    },
  );
  return data?.claims?.nodes?.[0] ?? undefined;
};

type IId = {
  iid: {
    linkedResource: Array<{
      id: string;
      type: string;
      proof: string;
      right: string;
      encrypted: string;
      mediaType: string;
      description: string;
      serviceEndpoint: string;
    }>;
  };
};
export async function hasAuthzSAClaims(
  userDid: string,
  collectionId: string,
): Promise<boolean> {
  const idDoc = (await request(
    BLOCKSYNC_GRAPHQL_URL,
    `query Iid {
    iid(id: "${userDid}") {
        linkedResource
    }
}`,
    {},
  )) as IId;

  const offer = idDoc.iid.linkedResource.some(
    (item) =>
      item.id === `{id}#offer#${collectionId}` &&
      item.type === 'DeedOffer' &&
      item.description.includes(`${collectionId}#SA`),
  );

  return offer;
}
