import { Logger } from "@ixo/logger";

const ERROR_CODES = ['M_UNKNOWN_TOKEN', 'M_FORBIDDEN'];
export async function verifyMatrixOpenIdToken(
  openIdToken: string,
  baseUrl: string,
): Promise<{ isValid: boolean; userId?: string; error?: string }> {
  try {
    // Make request to Matrix federation endpoint
    const response = await fetch(
      `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/_matrix/federation/v1/openid/userinfo?access_token=${openIdToken}`,
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
    const error = await response.json() as { errcode: string };
    const isAuthError = ERROR_CODES.includes(error.errcode);
    if (!isAuthError) { 
      Logger.error('Error verifying Matrix OpenID token:', error);
    }
    return {
      isValid: false,
      error: `Server returned ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('Error verifying Matrix OpenID token:', errorMessage, errorStack);
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
