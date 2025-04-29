import { Logger } from '@ixo/logger';
import {
  LocalStorageCryptoStore,
  MemoryStore,
  createClient,
  type MatrixClient,
} from 'matrix-js-sdk';
import { LocalJsonStorage } from '../local-storage/local-storage';
import createMatrixClient from './create-matrix-client';

const cryptoStore = new LocalStorageCryptoStore(
  new LocalJsonStorage(
    process.env.MATRIX_CRYPTO_STORE_PATH || './matrix-crypto-store-new',
  ),
);
const store = new MemoryStore({
  localStorage: new LocalJsonStorage(
    process.env.MATRIX_STORE_PATH || './matrix-store-new',
  ),
});
/**
 * Creates an Oracle Admin Matrix client.
 *
 * This function initializes a Matrix client using environment variables for
 * the base URL, access token, user ID, and device ID. If any of these environment
 * variables are missing, an error is thrown.
 *
 * @returns [MatrixClient] The initialized Matrix client.
 *
 * @throws [Error] If any required environment variables are missing.
 */
export const createOracleAdminClient = async (
  _overrideAccessToken?: string,
): Promise<MatrixClient> => {
  const baseUrl = process.env.MATRIX_BASE_URL;
  const accessToken = process.env.MATRIX_ORACLE_ADMIN_ACCESS_TOKEN;
  const userId = process.env.MATRIX_ORACLE_ADMIN_USER_ID;

  if (!baseUrl || !accessToken || !userId) {
    const missingEnvVarsMsg = [
      'MATRIX_BASE_URL',
      'MATRIX_ORACLE_ADMIN_ACCESS_TOKEN',
      'MATRIX_ORACLE_ADMIN_USER_ID',
    ]
      .filter((envVar) => !process.env[envVar])
      .join(', ');
    throw new Error(
      `Missing required environment variables: ${missingEnvVarsMsg}`,
    );
  }

  const loginResponse = await getLoginResponse(baseUrl, accessToken);
  const client = createMatrixClient({
    baseUrl,
    accessToken: loginResponse.access_token,
    userId: loginResponse.user_id,
    deviceId: loginResponse.device_id,
    cryptoStore,
    store,
  });

  return client;
};

const getLoginResponse = async (
  baseUrl: string,
  token: string,
): Promise<{
  access_token?: string;
  user_id?: string;
  device_id?: string;
}> => {
  try {
    const tempClient = createClient({
      baseUrl,
      accessToken: token,
    });
    const loginResponse = await tempClient.whoami();
    tempClient.stopClient();
    tempClient.removeAllListeners();
    tempClient.http.abort();
    return {
      access_token: token,
      device_id: loginResponse.device_id,
      user_id: loginResponse.user_id,
    };
  } catch (error) {
    Logger.error('Failed to get login response for Admin account');
    throw error;
  }
};
