import { MatrixError, MatrixManager } from '@ixo/matrix';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { type IncomingHttpHeaders } from 'node:http';

export interface AuthHeaders {
  matrixAccessToken: string;
  matrixHomeServer?: string;
}

export async function getAuthHeaders(headers: IncomingHttpHeaders): Promise<AuthHeaders> {
  const matrixAccessTokenHeader = headers['x-matrix-access-token'];
  const matrixHomeServerHeader = headers['x-matrix-homeserver'];

  let matrixAccessToken: string | undefined;

  if (typeof matrixAccessTokenHeader === 'string') {
    matrixAccessToken = matrixAccessTokenHeader;
  } else if (Array.isArray(matrixAccessTokenHeader)) {
    matrixAccessToken = matrixAccessTokenHeader[0];
  }

  if (!matrixAccessToken) {
    throw new BadRequestException(
      'Missing or invalid required authentication headers: x-matrix-access-token',
    );
  }

  const matrixHomeServer = typeof matrixHomeServerHeader === 'string'
    ? matrixHomeServerHeader
    : Array.isArray(matrixHomeServerHeader)
      ? matrixHomeServerHeader[0]
      : undefined;

  return { matrixAccessToken, matrixHomeServer };
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

export const getLoginResponse = async (matrixAccessToken: string) => {
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
