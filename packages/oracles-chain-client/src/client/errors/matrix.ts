/**
 * Enum representing different types of authentication errors.
 */
export enum MatrixAuthenticationErrorCodes {
  MISSING_TOKEN = 'MISSING_TOKEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
}

/**
 * Base class for authentication-related errors.
 * Extends the built-in Error class with an error code.
 */
export class MatrixAuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code: MatrixAuthenticationErrorCodes,
  ) {
    super(message);
    this.name = 'MatrixAuthenticationError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MatrixAuthenticationError);
    }
  }
}

/**
 * Error class for when a token is missing.
 * Used when a user doesn't provide a token at all.
 */
export class MissingMatrixTokenError extends MatrixAuthenticationError {
  constructor() {
    super(
      'Matrix authentication token is missing',
      MatrixAuthenticationErrorCodes.MISSING_TOKEN,
    );
    this.name = 'MissingMatrixTokenError';
  }

  /**
   * Type guard to check if an error is a MissingMatrixTokenError
   */
  static isMissingMatrixTokenError(error: unknown): error is MissingMatrixTokenError {
    return (
      error instanceof MissingMatrixTokenError &&
      error.code === MatrixAuthenticationErrorCodes.MISSING_TOKEN
    );
  }
}

/**
 * Error class for when a token is invalid.
 * Used when a user provides a token that is not valid (expired, malformed, etc).
 */
export class InvalidMatrixTokenError extends MatrixAuthenticationError {
  constructor(details?: string) {
    const message = details
      ? `Matrix authentication token is invalid: ${details}`
      : 'Matrix authentication token is invalid';

    super(message, MatrixAuthenticationErrorCodes.INVALID_TOKEN);
    this.name = 'InvalidMatrixTokenError';
  }

  /**
   * Type guard to check if an error is an InvalidMatrixTokenError
   */
  static isInvalidMatrixTokenError(error: unknown): error is InvalidMatrixTokenError {
    return (
      error instanceof InvalidMatrixTokenError &&
      error.code === MatrixAuthenticationErrorCodes.INVALID_TOKEN
    );
  }
}
