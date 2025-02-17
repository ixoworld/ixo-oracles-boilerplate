import { request } from '../helpers/request';
import type { CreateSessionResponse, IListSessionsResponse } from './types';

export async function listSessions({
  apiUrl,
  apiKey,
  did,
  matrixAccessToken,
}: {
  apiUrl: string;
  apiKey: string;
  did: string;
  matrixAccessToken: string;
}): Promise<IListSessionsResponse> {
  const response = await request<IListSessionsResponse>(`${apiUrl}/sessions`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ did, matrixAccessToken }),
  });

  return response;
}

export async function createSession({
  apiUrl,
  apiKey,
  did,
  matrixAccessToken,
}: {
  apiUrl: string;
  apiKey: string;
  did: string;
  matrixAccessToken: string;
}): Promise<CreateSessionResponse> {
  const response = await request<CreateSessionResponse>(`${apiUrl}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ did, matrixAccessToken }),
  });

  return response;
}

export async function deleteSession({
  apiUrl,
  apiKey,
  did,
  matrixAccessToken,
  sessionId,
}: {
  apiUrl: string;
  apiKey: string;
  did: string;
  matrixAccessToken: string;
  sessionId: string;
}): Promise<void> {
  await request(`${apiUrl}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ did, matrixAccessToken }),
  });
}

export async function updateSessionTitle({
  apiUrl,
  apiKey,
  sessionId,
  matrixAccessToken,
  title,
}: {
  apiUrl: string;
  apiKey: string;
  sessionId: string;
  matrixAccessToken: string;
  title: string;
}): Promise<void> {
  await request(`${apiUrl}/sessions/${sessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ title, matrixAccessToken }),
  });
}
