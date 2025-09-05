// Types for entity verification methods based on actual response
interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyBase58?: string;
  publicKeyMultibase?: string;
  blockchainAccountID?: string;
}

interface IIdVerificationData {
  verificationMethod: VerificationMethod[];
}

interface IidDocumentResponse {
  iid: IIdVerificationData;
}

// GraphQL query to fetch only verification methods
const GET_IID_VERIFICATION_METHODS = `
  query GetIidVerificationMethods($id: String!) {
    iid(id: $id) {
      verificationMethod
    }
  }
`;

/**
 * Get the public key base58 from the entity verification methods
 * @param userDid - The ID of the user
 * @returns The public key base58
 */
export const getPublicKeyBase58 = async (
  userDid: string,
): Promise<string | undefined> => {
  const GRAPHQL_ENDPOINT =
    process.env.BLOCKSYNC_GRAPHQL_URL || process.env.NEXT_PUBLIC_GRAPHQL_URL;

  if (!GRAPHQL_ENDPOINT) {
    throw new Error('GraphQL endpoint not configured');
  }

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: GET_IID_VERIFICATION_METHODS,
        variables: {
          id: userDid,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: { data: IidDocumentResponse } = await response.json();

    if (!data.data?.iid) {
      throw new Error('Iid not found with did: ' + userDid);
    }

    // Parse the verificationMethod JSON field
    const verificationMethods = Array.isArray(data.data.iid.verificationMethod)
      ? data.data.iid.verificationMethod
      : [];

    const publicKeyBase58 = verificationMethods.find(
      (method) => method.publicKeyBase58,
    )?.publicKeyBase58;

    return publicKeyBase58;
  } catch (error) {
    console.error('Error fetching entity verification methods:', error);
    throw error;
  }
};
