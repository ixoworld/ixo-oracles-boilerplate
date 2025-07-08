import * as z from 'zod/v3';

export type TGetSurveyJsDomainSchema = z.infer<typeof GetSurveyJsDomainSchema>;
export const GetSurveyJsDomainSchema = z.object(
  {
    protocolDid: z.string({
      description:
        'The DID of the protocol that will be used to create the domain(Entity, project, asset, protocol/*)',
    }),
  },
  {
    description: 'Get the Domain creation Form for a given protocol DID',
  },
);
export type TGetSettingsResourceSchema =
  | (z.infer<typeof GetSettingsResourceSchema> & {
      id: string;
    })
  | (z.infer<typeof GetSettingsResourceSchema> & {
      type: string;
    });
export const GetSettingsResourceSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
  })
  .merge(GetSurveyJsDomainSchema);

/**
 * @description The type of the message to create an entity via HTTP POST request
 * @example - On the client side
 * const messageValue = ixo.entity.v1beta1.MsgCreateEntity.fromPartial({...})
 * const entityAsBuffer = ixo.entity.v1beta1.MsgCreateEntity.encode(messageValue).finish()
 *
 * Then a post request to the server with this Buffer
 *
 * @example - On the server side
 * const message = req.body.message;
 * const buffer = Buffer.from(message);
 * const decodedMessage = ixo.entity.v1beta1.MsgCreateEntity.decode(buffer); // decodedMessage is the same as messageValue and it's ready to be used to create an entity on the chain
 */
export type CreateEntityParams = Uint8Array;
