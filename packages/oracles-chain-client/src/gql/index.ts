import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { getSdk } from './generated/sdk.js';

dotenv.config();
/**
 * GraphQL endpoint URL for the IXO Blocksync API
 * This points to the testnet environment
 */
const GRAPHQL_ENDPOINT = process.env.BLOCKSYNC_GRAPHQL_URL;

if (!GRAPHQL_ENDPOINT) {
  throw new Error('BLOCKSYNC_GRAPHQL_URL is not set');
}

/**
 * GraphQL client instance configured with the IXO Blocksync endpoint
 * This is used internally by the SDK
 */
const graphqlClient = new GraphQLClient(GRAPHQL_ENDPOINT);

/**
 * Type-safe SDK for making GraphQL requests to the IXO Blocksync API
 * This client provides auto-generated methods for all defined GraphQL operations
 */
export const gqlClient = getSdk(graphqlClient);

/**
 * Export all generated types from the GraphQL schema
 * This includes types for queries, mutations, and entity data structures
 */
export * from './generated/graphql.js';

export * from './gqlWrapper.js';
export { default as gql } from './gqlWrapper.js';
