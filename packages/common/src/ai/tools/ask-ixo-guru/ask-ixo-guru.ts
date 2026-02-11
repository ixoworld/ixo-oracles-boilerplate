import { tool } from '@langchain/core/tools';
import  z from 'zod';
import { jsonToYaml } from '../../utils/json-to-yaml.js';

export type RequestPayload = {
  message: string;
  did: string;
  sessionId: string;
};

export type ResponsePayload = {
  message: {
    type: 'ai';
    content: string;
  };
  docs: [];
  sessionId: string;
};

const callGuruApi = async ({
  question,
  sessionId,
}: {
  question: string;
  sessionId: string;
}): Promise<string> => {
  if (!process.env.IXO_GURU_QUERY_ENDPOINT) {
    throw new Error('IXO Guru API URL is not set');
  }

  if (!process.env.GURU_ASSISTANCE_API_TOKEN) {
    throw new Error('Guru Assistance API token is not set');
  }
  if (!process.env.ORACLE_DID) {
    throw new Error('Oracle DID is not set');
  }
  const payload: RequestPayload = {
    message: question,
    did: process.env.ORACLE_DID ?? '',
    sessionId,
  };

  const response = await fetch(process.env.IXO_GURU_QUERY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GURU_ASSISTANCE_API_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }

  const data = (await response.json()) as ResponsePayload;
  return jsonToYaml({
    answer: data.message.content,
    sessionId: data.sessionId,
  });
};

export const askIXOGuruTool = tool(callGuruApi, {
  name: 'ask_guru_ai',
  description:
    'Ask the IXO Guru AI a question - IXO guru has access to internal knowledge base of IXO organization this tool will return the answer and the session ID to use for chat history if you want to continue a conversation within the same session send the same session ID otherwise a new session ID',
  schema: z.object({
    question: z.string( 'The question to ask the IXO Guru AI',),
    sessionId: z
      .string( 'The session ID to use for chat history if you want to continue a conversation within the same session send the same session ID otherwise a new session ID',)
      .uuid( 'Session ID must be a valid UUID',),
  }),
});
