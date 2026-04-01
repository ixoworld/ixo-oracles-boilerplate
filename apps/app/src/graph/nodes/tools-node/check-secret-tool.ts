import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { SecretsService } from 'src/secrets/secrets.service';
import z from 'zod';

const logger = new Logger('check_secret');

/**
 * Creates a `check_secret` LangGraph tool that checks whether a user secret
 * is configured in the current Matrix room. If the secret is missing, the
 * frontend renders a component that opens the Settings panel so the user can
 * add it.
 */
export function createCheckSecretTool(
  roomId: string,
  oracleEntityDid: string,
) {
  return tool(
    async ({ name, description }) => {
      logger.log(
        `Tool invoked — roomId=${roomId}, secret=${name}`,
      );

      try {
        const index =
          await SecretsService.getInstance().getSecretIndex(roomId);
        const exists = index.some((entry) => entry.name === name);

        const result = {
          name,
          description,
          exists,
          oracleEntityDid,
        };

        return JSON.stringify(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Tool error: ${msg}`);
        return `[Error checking secret: ${msg}]`;
      }
    },
    {
      name: 'check_secret',
      description:
        'Check if a user secret is configured. If not configured, prompts the user to add it via the Settings panel. ' +
        "Use this when a skill or tool requires a secret (like an API key) that the user hasn't set up yet.",
      schema: z.object({
        name: z
          .string()
          .describe('The secret name, e.g. "GITHUB_TOKEN".'),
        description: z
          .string()
          .describe('Why this secret is needed, shown to the user.'),
      }),
    },
  );
}
