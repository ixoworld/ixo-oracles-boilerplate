import { z } from 'zod';

export enum GraphNodes {
  Chat = 'Chat',
  Tools = 'Tools',
  AgentWithChainOfThoughts = 'AgentWithChainOfThoughts',
  Evaluation = 'Evaluation',
}
export const contextSchema = z.object({
  userDid: z.string(),
});

export type TChatNodeContext = z.infer<typeof contextSchema>;
