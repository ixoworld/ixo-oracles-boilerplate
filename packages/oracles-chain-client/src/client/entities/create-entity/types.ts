import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { z } from 'zod';

interface CreateEntityParams {
  config: {
    relayerNode: string;
    owner: 'user' | 'dao';
    ownerCoreAddress: string;
  };
  wallet: DirectSecp256k1HdWallet;
  value?: TEntitySchema;
}

export type { CreateEntityParams };

const validateDid = (did: string) => {
  return did.startsWith('did:');
};
export type TEntitySchema = z.infer<typeof EntitySchema>;
export const EntitySchema = z.object(
  {
    entityType: z.string(),
    context: z.array(z.object({ key: z.string(), val: z.string() })).nullish(),
    controllers: z.array(
      z.string().refine(validateDid, {
        message: 'Invalid DID',
      }),
    ),
    entityStatus: z.number().nullish().default(0),
    startDate: z.date(),
    endDate: z.date(),
    ownerAddress: z.string(),
    ownerDid: z.string().refine(validateDid, {
      message: 'Invalid DID',
    }),
    relayerNode: z.string().refine(validateDid, {
      message: 'Invalid DID',
    }),
    services: z.array(
      z.object({
        id: z.string(),
        serviceEndpoint: z.string(),
        type: z.string(),
      }),
    ),
    linkedResources: z.array(
      z
        .object({
          id: z.string(),
          type: z.string(),
          description: z.string(),
          mediaType: z.string(),
          serviceEndpoint: z.string(),
          proof: z.string(),
          encrypted: z.string(),
          right: z.string(),
        })
        .nullish(),
    ),
    accordedRights: z
      .array(
        z
          .object({
            type: z.string(),
            id: z.string(),
            mechanism: z.string(),
            message: z.string(),
            service: z.string(),
          })
          .nullish(),
      )
      .nullish(),
    linkedEntities: z.array(
      z
        .object({
          type: z.string(),
          id: z.string(),
          relationship: z.string(),
          service: z.string(),
        })
        .nullish(),
    ),
    linkedClaims: z.array(
      z
        .object({
          type: z.string(),
          id: z.string(),
          description: z.string(),
          serviceEndpoint: z.string(),
          proof: z.string(),
          encrypted: z.string(),
          right: z.string(),
        })
        .nullish(),
    ),
  },
  {
    description:
      'An ​entity​ is a digital representation of a person, organization, or device within a digital identity system. like DAOs, Projects, Investments, Oracles, Assets, Deeds, Protocols',
  },
);

export type TGetSurveyJsDomainSchema = z.infer<typeof GetSurveyJsDomainSchema>;
export const GetSurveyJsDomainSchema = z.object(
  {
    protocolDid: z
      .string({
        description:
          'The DID of the protocol that will be used to create the domain(Entity, project, asset, protocol/*)',
      })
      .refine(validateDid, {
        message: 'Invalid DID',
      }),
  },
  {
    description: 'Get the Domain creation Form for a given protocol DID',
  },
);
export type TGetSettingsResourceSchema = z.infer<typeof GetSettingsResourceSchema>;
export const GetSettingsResourceSchema = z.object({
  key: z.string(),
}).merge(GetSurveyJsDomainSchema);