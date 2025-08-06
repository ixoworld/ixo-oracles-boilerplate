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
  console.log('loginResponse', loginResponse);
  return loginResponse;
}
login('https://devmx.ixo.earth', '@did-ixo-:devmx.ixo.earth', '');
