import { Request } from 'express';
import httpErrors from 'http-errors';

export const getAuthHeadersValue = (req: Request) => {
  const matrixAccessToken = req.headers['x-matrix-access-token'] as string;
  const did = req.headers['x-did'] as string;
  if (!matrixAccessToken || !did) {
    throw httpErrors.Unauthorized(
      'Unauthorized: missing matrix access token or did in header x-matrix-access-token or x-did',
    );
  }
  return { matrixAccessToken, did };
};
