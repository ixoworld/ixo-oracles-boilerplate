// import {
//   getOpenRouterChatModel,
//   parserBrowserTool,
//   SearchEnhancedResponse,
// } from '@ixo/common';
// import { IRunnableConfigWithRequiredFields } from '@ixo/matrix';
// import { RunnableConfig } from '@langchain/core/runnables';
// import { Logger } from '@nestjs/common';
// import { createDeepAgent } from 'deepagents';
// import { AIMessage } from 'langchain';
// import { createDomainIndexerAgent } from 'src/graph/agents/domain-indexer-agent';
// import {
//   createEditorAgent,
//   EditorAgentInstance,
// } from 'src/graph/agents/editor/editor-agent';
// import { createFirecrawlAgent } from 'src/graph/agents/firecrawl-agent';
// import { createMemoryAgent } from 'src/graph/agents/memory-agent';
// import { createPortalAgent } from 'src/graph/agents/portal-agent';
// import { createSafetyGuardrailMiddleware } from 'src/graph/middlewares/safety-guardrail-middleware';
// import { createTokenLimiterMiddleware } from 'src/graph/middlewares/token-limiter-middelware';
// import { createToolValidationMiddleware } from 'src/graph/middlewares/tool-validation-middleware';
// import z from 'zod';
// import { type TMainAgentGraphState } from '../../state';
// import {
//   AI_ASSISTANT_PROMPT,
//   EDITOR_DOCUMENTATION_CONTENT_READ_ONLY,
//   SLACK_FORMATTING_CONSTRAINTS_CONTENT,
// } from './prompt';
// import { cleanAdditionalKwargs } from './utils';
// import { createMainAgent } from 'src/graph/agents/main-agent';

import z from 'zod';

export const contextSchema = z.object({
  userDid: z.string(),
});

export type TChatNodeContext = z.infer<typeof contextSchema>;

// export async function chatNode(
//   state: TMainAgentGraphState,
//   config?: RunnableConfig,
// ): Promise<Partial<TMainAgentGraphState>> {

//   const agent = await createMainAgent({ state, config });
//   const result = await agent.invoke(
//     {
//       messages: state.messages,
//       did: userConfig?.did ?? 'fuck you motherfucker',
//     },
//     {
//       ...config,
//       configurable: {
//         ...config?.configurable,
//       },

//       context: {
//         userDid: userConfig?.did ?? '',
//       },
//       durability: 'async',
//     },
//   );

//   if (!result.messages) {
//     Logger.debug('No messages returned from agent', result);
//     return result;
//   }

//   const message: AIMessage = result.messages.at(-1);

//   if (!message) {
//     throw new Error('No message returned from agent');
//   }

//   message.additional_kwargs.msgFromMatrixRoom = msgFromMatrixRoom;
//   message.additional_kwargs.timestamp = new Date().toISOString();

//   const cleanedKwargs = cleanAdditionalKwargs(
//     message.additional_kwargs,
//     msgFromMatrixRoom,
//   );
//   message.additional_kwargs = cleanedKwargs;

//   return {
//     messages: result.messages,
//   };
// }

// // Helper function to format SearchEnhancedResponse into readable context
// const formatContextData = (data: SearchEnhancedResponse | undefined) => {
//   if (!data) return 'No specific information available.';

//   let context = '';

//   if (data.facts && data.facts.length > 0) {
//     context += '**Key Facts:**\n';
//     data.facts.slice(0, 3).forEach((fact: any) => {
//       context += `- ${fact.fact}\n`;
//     });
//   }

//   if (data.entities && data.entities.length > 0) {
//     context += '\n**Relevant Entities:**\n';
//     data.entities.slice(0, 3).forEach((entity: any) => {
//       context += `- ${entity.name}: ${entity.summary}\n`;
//     });
//   }

//   if (data.episodes && data.episodes.length > 0) {
//     context += '\n**Recent Episodes:**\n';
//     data.episodes.slice(0, 2).forEach((episode: any) => {
//       context += `- ${episode.name}: ${episode.content.substring(0, 100)}...\n`;
//     });
//   }

//   return context || 'No specific information available.';
// };

// // Helper function to format time context
// const formatTimeContext = (
//   timezone: string | undefined,
//   currentTime: string | undefined,
// ): string => {
//   if (!timezone && !currentTime) {
//     return 'Not available.';
//   }

//   let context = '';

//   if (currentTime) {
//     context += `Current local time: ${currentTime}`;
//   }

//   if (timezone) {
//     if (context) {
//       context += `\nTimezone: ${timezone}`;
//     } else {
//       context += `Timezone: ${timezone}`;
//     }
//   }

//   return context || 'Not available.';
// };
