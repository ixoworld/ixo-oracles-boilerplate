import { MatrixError, MatrixManager } from '@ixo/matrix';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { type IncomingHttpHeaders } from 'node:http';

export async function getAuthHeaders(headers: IncomingHttpHeaders): Promise<{
  matrixAccessToken: string;
  did: string;
}> {
  const matrixAccessTokenHeader = headers['x-matrix-access-token'];

  if (typeof matrixAccessTokenHeader !== 'string') {
    const matrixAccessToken = Array.isArray(matrixAccessTokenHeader)
      ? matrixAccessTokenHeader[0]
      : matrixAccessTokenHeader;

    if (!matrixAccessToken) {
      throw new BadRequestException(
        'Missing or invalid required authentication headers: x-matrix-access-token',
      );
    }
    const loginResponse = await getLoginResponse(matrixAccessToken);
    const did = normalizeDid(loginResponse.user_id);
    Logger.debug(`Matrix access token: ${matrixAccessToken}`);
    Logger.debug(`DID: ${did}`);
    return { matrixAccessToken, did };
  }

  const loginResponse = await getLoginResponse(matrixAccessTokenHeader);
  const did = normalizeDid(loginResponse.user_id);

  return { matrixAccessToken: matrixAccessTokenHeader, did };
}

/**
 * Converts a DID from hyphen-delimited form (“did-ixo-…”)
 * to colon-delimited form (“did:ixo:…”).
 *
 * @param input - The DID string, e.g. "did-ixo-ixo1abc..."
 * @returns The normalized DID, e.g. "did:ixo:ixo1abc..."
 */
export function normalizeDid(input: string): string {
  const [username] = input.split(':');
  const parts = username.split('-');
  if (parts.length < 3 || parts[0] !== '@did') {
    throw new Error(`Invalid DID format: ${input}`);
  }
  const namespace = parts[1];
  // In case the identifier itself contains hyphens, re-join the rest
  const identifier = parts.slice(2).join('-');
  return `did:${namespace}:${identifier}`;
}

const getLoginResponse = async (matrixAccessToken: string) => {
  try {
    const matrixManager = MatrixManager.getInstance();
    const loginResponse =
      await matrixManager.getLoginResponse(matrixAccessToken);
    return loginResponse;
  } catch (error) {
    if (error instanceof MatrixError) {
      // if the error is a MatrixError, check if the errcode is M_FORBIDDEN
      if (
        error.errcode === 'M_FORBIDDEN' ||
        error.errcode === 'M_UNKNOWN_TOKEN'
      ) {
        throw new ForbiddenException(error.message);
      }
      throw new BadRequestException(error.message);
    }
    throw new BadRequestException(
      'Missing or invalid required authentication headers: x-matrix-access-token',
    );
  }
};
