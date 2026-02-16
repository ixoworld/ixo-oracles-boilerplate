import type React from 'react';
import { type z } from 'zod';

export interface IActionToolParams {
  toolName: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<unknown> | unknown;
  render?: (props: {
    status?: 'isRunning' | 'done';
    args?: unknown;
    result?: unknown;
    isLoading?: boolean;
  }) => React.ReactElement | null;
}

export type IActionTools = Record<string, IActionToolParams>;
