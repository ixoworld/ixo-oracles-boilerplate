import { z } from 'zod';

export interface IBrowserToolParams {
  description: string;
  schema: z.ZodTypeAny;
  toolName: string;
  fn: (args: any) => Promise<unknown>;
}

export type IBrowserTools = Record<string, IBrowserToolParams>;
