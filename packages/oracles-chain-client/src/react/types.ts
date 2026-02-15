import  z  from 'zod';

export type TOraclePricingListSchemaResponse = z.infer<
  typeof OraclePricingListSchemaResponse
>;
export const OraclePricingListSchemaResponse = z.array(
  z.object({
    title: z.string(),
    description: z.string(),
    amount: z.string(),
    denom: z.string(),
  }),
);

export type TOraclePricingLisJSONLD = {
  '@context': [string, { ixo: string; oracle: Record<string, unknown> }];
  '@type': string;
  '@id': string;
  name: string;
  description: string;
  serviceType: string;
  offers: {
    '@type': string;
    priceCurrency: string;
    priceSpecification: {
      '@type': string;
      priceCurrency: string;
      price: number;
      unitCode: string;
      billingIncrement: number;
      billingPeriod: string;
      priceType: string;
      maxPrice: number;
    };
    eligibleQuantity: {
      '@type': string;
      value: number;
      unitCode: string;
    };
  };
};
