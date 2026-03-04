import { compactDecrypt, importJWK, type JWK } from 'jose';

export type { JWK };

export async function decryptJWE(
  jwe: string,
  privateJwk: JWK,
): Promise<string> {
  const key = await importJWK(privateJwk, 'ECDH-ES+A256KW');
  const { plaintext } = await compactDecrypt(jwe, key);
  return new TextDecoder().decode(plaintext);
}
