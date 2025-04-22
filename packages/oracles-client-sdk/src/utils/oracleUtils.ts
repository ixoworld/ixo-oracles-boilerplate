import { OracleData } from '../types';

/**
 * Format oracle data for display
 * @param data - The oracle data to format
 * @returns Formatted oracle data as a string
 */
export const formatOracleData = (data: OracleData): string => {
  return `Oracle ${data.id}: ${JSON.stringify(data.data)} (Updated: ${data.timestamp.toLocaleString()})`;
};

/**
 * Validate oracle data format
 * @param data - The data to validate
 * @returns Whether the data is valid
 */
export const isValidOracleData = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;

  // Add actual validation logic here
  // For now, just a placeholder implementation
  return true;
};
