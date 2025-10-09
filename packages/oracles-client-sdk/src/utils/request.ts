/**
 * JSON request utility for API calls
 * @param url - The URL to fetch
 * @param options - Request options
 * @returns Promise resolving to parsed JSON data
 */
type RequestOptions = RequestInit & {
  timeout?: number;
  apiKey?: string;
};

export const request = async <T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  options: RequestOptions = {},
): Promise<T> => {
  const {
    timeout = 120000, // 2 minutes
    apiKey,
    ...fetchOptions
  } = options;

  // Set up timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
    });

    // Clear timeout since request completed
    clearTimeout(timeoutId);

    // Handle error responses
    if (!response.ok) {
      const errorData = (await response.json()) as {
        error: string;
        outstandingClaims?: string[];
        message: string;
        statusCode: number;
      };

      throw new RequestError(errorData.message, {
        status: errorData.statusCode,
        error: errorData.error,
        message: errorData.message,
        outstandingClaims: errorData.outstandingClaims,
      });
    }

    // Parse and return JSON
    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    // Re-throw AbortError with timeout message
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
};

export default request;

class RequestError extends Error {
  status?: number;
  outstandingClaims?: string[];
  [key: string]: any;

  constructor(message: string, errorProps?: Record<string, any>) {
    super(message);
    this.name = 'RequestError';

    // Add all properties from errorProps to the error instance
    if (errorProps) {
      Object.assign(this, errorProps);
    }
  }

  static isRequestError(error: unknown): error is RequestError {
    return error instanceof RequestError;
  }
}

export { RequestError };
