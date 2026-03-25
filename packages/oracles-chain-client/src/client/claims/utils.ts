export async function getUserOraclesClaimCollection(
  userAddress: string,
): Promise<string | undefined> {
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }
  console.warn(
    '[Authz] getUserOraclesClaimCollection is not implemented',
    'getUserOraclesClaimCollection',
    'notImplemented',
    'userAddress',
    userAddress,
  );
  console.warn(
    '[Authz] getUserOraclesClaimCollection returning hardcoded value',
  );
  return process.env.USER_CLAIM_COLLECTION_ID ?? '138';
}
