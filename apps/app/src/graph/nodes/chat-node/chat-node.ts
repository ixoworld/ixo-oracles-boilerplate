import z from 'zod';

export const contextSchema = z.object({
  userDid: z.string(),
});

export type TChatNodeContext = z.infer<typeof contextSchema>;
