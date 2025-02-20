import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string(),
  CHROMA_URL: z.string(),
});
export type Schema = typeof envSchema;
