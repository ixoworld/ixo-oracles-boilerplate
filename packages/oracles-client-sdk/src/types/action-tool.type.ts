import type React from 'react';
import { z } from 'zod';

export interface IActionToolParams {
  toolName: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (args: any) => Promise<any> | any;
  render?: (props: {
    status?: 'isRunning' | 'done';
    args?: any;
    result?: any;
    isLoading?: boolean;
  }) => React.ReactElement | null;
}

export type IActionTools = Record<string, IActionToolParams>;
