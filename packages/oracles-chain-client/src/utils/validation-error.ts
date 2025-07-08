import { ZodError } from 'zod/v3';

export class ValidationError extends Error {
  public readonly errors?: ZodError;
  constructor(message: string, errors?: ZodError) {
    super(message);
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
    this.errors = errors;
  }

  static fromZodError(error: ZodError) {
    const message = error.errors.map((e) => e.message).join('\n');
    return new ValidationError(message, error);
  }

  static isValidationError(error: unknown): error is ValidationError {
    return error instanceof ValidationError;
  }
}
