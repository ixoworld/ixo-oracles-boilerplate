import z from 'zod';

export const UserContextSchema = z.object({
  name: z.string().describe("The user's preferred name or nickname"),
  communicationStyle: z
    .string()
    .nullable()
    .describe(
      "The user's communication style in summary, in 1-2 sentences, if not available, return null",
    ),
  recentSummary: z
    .string()
    .nullable()
    .describe(
      'A brief summary of recent events, in 1-2 sentences, if not available, return null',
    ),
  extraInfo: z
    .string()
    .nullable()
    .describe(
      'Extra information about the user, in 1-2 sentences, such as their preferences, interests, or other relevant information, if not available, return null',
    ),
});

export type TUserContext = z.infer<typeof UserContextSchema>;
