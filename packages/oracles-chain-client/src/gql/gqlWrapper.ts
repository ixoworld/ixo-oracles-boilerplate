import { gql as originalGql } from 'graphql-tag';

// Re-export the gql function to ensure consistent usage
export const gql = originalGql;

// Also export it as a property of itself for compatibility with both usage patterns
const gqlWithProperty = originalGql as typeof originalGql & {
  gql: typeof originalGql;
};
gqlWithProperty.gql = originalGql;

export default gqlWithProperty;
