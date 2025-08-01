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

login(
  'https://devmx.ixo.earth',
  '@did-ixo-ixo100qnkvpjlw9t63t3kvdxn6yczhmdphghvf4j3g:devmx.ixo.earth',
  'ZDg0NDczMWE1ZWYxOGRlYjNi',
);
