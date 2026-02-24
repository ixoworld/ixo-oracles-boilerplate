import { Logger } from '@ixo/logger';
import * as sdk from 'matrix-js-sdk';

export async function login(
  baseUrl: string,
  username: string,
  password: string,
) {
  const client = sdk.createClient({
    baseUrl,
  });

  const loginResponse = await client.loginWithPassword(username, password);
  Logger.info('loginResponse', loginResponse);
  return loginResponse;
}
