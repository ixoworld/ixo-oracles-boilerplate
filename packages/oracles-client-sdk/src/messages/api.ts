import { request } from '../helpers/request';
import type { IMessage } from './types';

export async function listMessages({
  apiUrl,
  apiKey,
  did,
  matrixAccessToken,
  sessionId,
  connectionId,
}: {
  apiUrl: string;
  apiKey: string;
  did: string;
  matrixAccessToken: string;
  sessionId: string;
  connectionId: string;
}): Promise<{ messages: IMessage[] }> {
  const response = await request<{ messages: IMessage[] }>(
    `${apiUrl}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        did,
        matrixAccessToken,
        wsId: connectionId,
        sessionId,
      }),
    },
  );

  return response;
}
