import { z } from 'zod';

export const envSchema = z.object({
  ORACLE_ADDRESS: z.string(),
  ORACLE_DID: z.string(),

  // MATRIX
  MATRIX_ORACLE_ADMIN_ACCESS_TOKEN: z.string().min(5),
  MATRIX_BASE_URL: z.string().url(),
  MATRIX_ORACLE_ADMIN_USER_ID: z.string(),
  MATRIX_RECOVERY_PHRASE: z.string(),
  OPENAI_API_KEY: z.string(),
});
export type Schema = typeof envSchema;
