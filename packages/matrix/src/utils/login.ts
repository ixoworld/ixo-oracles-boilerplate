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

login('https://devmx.ixo.earth', '@did-ixo-ixo1ws8ejgealhym4xy00pc2ktunpsr8ynf9657u4z:devmx.ixo.earth', 'NTNjNjViNDIwYzllYzE2MTc4');
