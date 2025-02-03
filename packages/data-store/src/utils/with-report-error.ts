import { Logger } from '@ixo/logger';

/**
 * should report using the logger and throw the error if the promise is rejected
 */
export const withReportError = async <T>(promise: Promise<T>): Promise<T> => {
  try {
    const res = await promise;
    return res;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Something went wrong in AirtableDataStore';
    Logger.error(errorMessage, error);
    throw error;
  }
};
