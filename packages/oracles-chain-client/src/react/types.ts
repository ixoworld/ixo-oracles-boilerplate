import { z } from 'zod';

export type TOraclePricingListSchemaResponse = z.infer<
  typeof OraclePricingListSchemaResponse
>;
export const OraclePricingListSchemaResponse = z.array(
  z.object({
    title: z.string(),
    description: z.string(),
    amount: z.object({
      amount: z.string(),
      denom: z.string(),
    }),
  }),
);
