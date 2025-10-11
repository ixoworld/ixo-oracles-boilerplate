export async function verifyMatrixOpenIdToken(
  openIdToken: string,
  matrixServerName: string = 'devmx.ixo.earth',
): Promise<{ isValid: boolean; userId?: string; error?: string }> {
  try {

    // Make request to Matrix federation endpoint
    const response = await fetch(
      `https://${matrixServerName}/_matrix/federation/v1/openid/userinfo?access_token=${openIdToken}`,
      {
        method: 'GET',
      },
    );

    if (response.ok) {
      const userInfo = (await response.json()) as { sub: string };
      console.log('User info from server:', userInfo);

      return {
        isValid: true,
        userId: userInfo.sub, // The verified user ID
      };
    }

    return {
      isValid: false,
      error: `Server returned ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
