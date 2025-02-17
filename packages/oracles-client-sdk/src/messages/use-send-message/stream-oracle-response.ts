import { type StreamOracleResponseParams } from '../types';

const streamOracleResponse = async (
  params: StreamOracleResponseParams,
): Promise<{
  text: string;
  requestId: string;
}> => {
  const abortController = new AbortController();

  const response = await fetch(`${params.apiURL}/stream`, {
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      did: params.did,
      matrixAccessToken: params.matrixAccessToken,
      message: params.message,
      wsId: params.connectionId,
      sessionId: params.sessionId,
    }),
    method: 'POST',
    signal: abortController.signal,
  });

  if (!response.ok) {
    const err = (await response.json()) as { message: string };
    throw new Error(err.message);
  }
  const requestId = response.headers.get('X-Request-Id');

  if (!requestId) {
    abortController.abort();
    throw new Error('Did not receive a request ID');
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No reader');
  }
  let text = '';

  let result = await reader.read();
  while (!result.done) {
    const { value } = result;

    const message = decoder.decode(value, {
      stream: true,
    });
    // eslint-disable-next-line no-await-in-loop -- This is intentional
    await params.cb({ requestId, message });
    text += message;
    // eslint-disable-next-line no-await-in-loop -- This is intentional
    result = await reader.read();
  }
  return {
    text,
    requestId,
  };
};

export { streamOracleResponse };
