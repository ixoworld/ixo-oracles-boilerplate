import { z } from 'zod';

/**
 * Zod schema for oracle.config.json.
 * Validates the config at import time and provides a single typed export,
 * eliminating all `as Record<string, unknown>` casts in consuming code.
 */
const mcpServerSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  description: z.string().optional(),
});

const promptSchema = z.object({
  opening: z.string().optional().default(''),
  communicationStyle: z.string().optional().default(''),
  capabilities: z.string().optional().default(''),
});

export const oracleConfigSchema = z.object({
  oracleName: z.string().default('My Oracle'),
  orgName: z.string().default(''),
  description: z.string().default(''),
  location: z.string().default(''),
  website: z.string().default(''),
  price: z.number().default(0),
  apiUrl: z.string().default('http://localhost:4000'),
  network: z.string().default('devnet'),
  entityDid: z.string().default(''),
  logo: z.string().default(''),
  prompt: promptSchema.optional().default({
    opening: '',
    communicationStyle: '',
    capabilities: '',
  }),
  model: z.string().optional().default(''),
  skills: z.array(z.string()).optional().default([]),
  customSkills: z.array(z.string()).optional().default([]),
  mcpServers: z.array(mcpServerSchema).optional().default([]),
});

export type OracleConfig = z.infer<typeof oracleConfigSchema>;

// Import and validate the raw JSON — fails fast at startup if config is malformed
import rawConfig from '../../../../oracle.config.json';

export const oracleConfig: OracleConfig = oracleConfigSchema.parse(rawConfig);
