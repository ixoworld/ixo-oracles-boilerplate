import crypto from 'node:crypto';

export const hashApiKey = (apiKey: string, salt: string, pepper: string) => {
  return crypto
    .createHash('sha256')
    .update(pepper)
    .update(salt)
    .update(apiKey)
    .digest('hex');
};
