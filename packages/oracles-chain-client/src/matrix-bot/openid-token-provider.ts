interface OpenIdTokenProviderConfig {
  matrixAccessToken: string;
  homeServerUrl: string;
  matrixUserId?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  matrixUserId: string;
}

export type GetOpenIdToken = () => Promise<string>;

const BACKOFF_DELAYS_MS = [500, 1000, 2000];

export class OpenIdTokenProvider {
  private cached: CachedToken | null = null;
  private mutex: Promise<void> = Promise.resolve();
  private readonly matrixAccessToken: string;
  private readonly homeServerUrl: string;
  private matrixUserId?: string;

  private static readonly EXPIRY_BUFFER_MS = 5 * 60 * 1000;

  constructor(config: OpenIdTokenProviderConfig) {
    this.matrixAccessToken = config.matrixAccessToken;
    this.homeServerUrl = config.homeServerUrl;
    this.matrixUserId = config.matrixUserId;
  }

  private async withMutex<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const acquired = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousMutex = this.mutex;
    this.mutex = acquired;
    await previousMutex;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  private async fetchWithRetry(matrixUserId: string): Promise<{ access_token: string; expires_in: number }> {
    for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        const delay = BACKOFF_DELAYS_MS[attempt - 1];
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await fetch(
        `${this.homeServerUrl}/_matrix/client/v3/user/${encodeURIComponent(matrixUserId)}/openid/request_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.matrixAccessToken}`,
          },
          body: '{}',
        },
      );

      if (response.ok) {
        return (await response.json()) as { access_token: string; expires_in: number };
      }

      if (response.status === 401 || response.status === 403) {
        const body = await response.text().catch(() => '');
        throw new Error(`Failed to get OpenID token: ${response.status} ${body}`);
      }

      if (attempt === BACKOFF_DELAYS_MS.length) {
        const body = await response.text().catch(() => '');
        throw new Error(`Failed to get OpenID token after ${attempt + 1} attempts: ${response.status} ${body}`);
      }
    }

    throw new Error('Failed to get OpenID token: exhausted retries');
  }

  async getToken(): Promise<string> {
    return this.withMutex(async () => {
      if (
        this.cached &&
        Date.now() < this.cached.expiresAt - OpenIdTokenProvider.EXPIRY_BUFFER_MS
      ) {
        return this.cached.accessToken;
      }

      let matrixUserId = this.cached?.matrixUserId ?? this.matrixUserId;
      if (!matrixUserId) {
        const whoamiResponse = await fetch(
          `${this.homeServerUrl}/_matrix/client/v3/account/whoami`,
          {
            headers: {
              Authorization: `Bearer ${this.matrixAccessToken}`,
            },
          },
        );
        if (!whoamiResponse.ok) {
          const body = await whoamiResponse.text().catch(() => '');
          throw new Error(
            `Failed to get whoami: ${whoamiResponse.status} ${body}`,
          );
        }
        const whoami = (await whoamiResponse.json()) as { user_id: string };
        if (!whoami.user_id) {
          throw new Error('whoami response missing user_id');
        }
        matrixUserId = whoami.user_id;
      }

      const data = await this.fetchWithRetry(matrixUserId);
      const expiresAt = Date.now() + data.expires_in * 1000;

      this.cached = { accessToken: data.access_token, expiresAt, matrixUserId };
      return data.access_token;
    });
  }
}

export function createOpenIdTokenProvider(
  config: OpenIdTokenProviderConfig,
): GetOpenIdToken {
  const provider = new OpenIdTokenProvider(config);
  return () => provider.getToken();
}
