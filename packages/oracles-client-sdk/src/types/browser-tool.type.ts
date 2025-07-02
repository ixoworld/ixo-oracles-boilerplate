import { type zodToJsonSchema } from 'zod-to-json-schema';

export interface IBrowserToolParams {
  description: string;
  schema: Parameters<typeof zodToJsonSchema>[0];
  toolName: string;
  fn: <T>(args: T) => Promise<unknown>;
}

export type IBrowserTools = Record<string, IBrowserToolParams>;
