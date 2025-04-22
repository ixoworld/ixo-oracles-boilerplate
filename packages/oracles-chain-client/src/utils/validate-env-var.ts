export const validateEnvVariable = (variableName: string): string => {
  const value = process.env[variableName] || '';
  if (!value) {
    throw new Error(`${variableName} is not set`);
  }
  return value;
};
