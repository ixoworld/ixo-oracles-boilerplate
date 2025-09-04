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
  '@did-ixo-ixo1nurj2fl232hjz5gr0atrhas3tzmfn0rlnsg3rk:devmx.ixo.earth',
  'M2FmM2FhNWM5YjJhZDA4NTFi',
);
