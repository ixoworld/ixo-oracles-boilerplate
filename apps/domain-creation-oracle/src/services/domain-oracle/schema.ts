import { z } from 'zod';
import {
  didSchema,
  matrixAccessTokenSchema,
} from '../../common/validation-schema.js';

export const listMessagesSchema = z.object({
  sessionId: z.string(),
  did: didSchema,
  matrixAccessToken: matrixAccessTokenSchema,
});

export type ListMessagesSchema = z.infer<typeof listMessagesSchema>;

export const sendMessageSchema = z.object({
  stream: z.boolean().optional().default(false),
  message: z.string(),
});

export type SendMessageSchema = z.infer<typeof sendMessageSchema>;
