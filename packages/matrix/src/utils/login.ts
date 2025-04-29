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
  'https://devmx.ixo.earth/',
  '@did-ixo-ixo1sdf4ny5yuxvz8hzhgnrjkd674f32v34ru8afe7:devmx.ixo.earth',
  'password',
);
