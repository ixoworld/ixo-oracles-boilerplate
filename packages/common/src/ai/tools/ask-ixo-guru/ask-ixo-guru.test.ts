import { jsonToYaml } from '../../utils/json-to-yaml.js';
import type { RequestPayload, ResponsePayload } from './ask-ixo-guru.js';
import { askIXOGuruTool } from './ask-ixo-guru.js';

type FetchResponse = {
  ok: boolean;
  statusText?: string;
  json: () => Promise<ResponsePayload>;
};

describe('Ask Ixo Guru Tool', () => {
  const originalEnv = process.env;
  const mockSessionId = 'cc9e0685-673b-4973-9315-f0761c9019d3';

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      IXO_GURU_QUERY_ENDPOINT: 'https://api.ixo.com/guru',
      GURU_ASSISTANCE_API_TOKEN: 'test-token',
      ORACLE_DID: 'did:ixo:test-oracle',
      MATRIX_ORACLE_ADMIN_ACCESS_TOKEN: 'matrix-token',
    };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('should successfully call the Guru API and return an answer', async () => {
    const mockResponse: ResponsePayload = {
      message: {
        type: 'ai',
        content: 'This is the answer',
      },
      docs: [],
      sessionId: mockSessionId,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as FetchResponse);

    const result = (await askIXOGuruTool.invoke({
      question: 'What is IXO?',
      sessionId: mockSessionId,
    })) as string;

    const expectedPayload: RequestPayload = {
      matrixAccessToken: 'matrix-token',
      message: 'What is IXO?',
      did: 'did:ixo:test-oracle',
      sessionId: mockSessionId,
    };

    expect(result).toBe(
      jsonToYaml({
        answer: 'This is the answer',
        sessionId: mockSessionId,
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.ixo.com/guru',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify(expectedPayload),
      }),
    );
  });

  it('should throw error when IXO_GURU_QUERY_ENDPOINT is not set', async () => {
    delete process.env.IXO_GURU_QUERY_ENDPOINT;

    await expect(
      askIXOGuruTool.invoke({
        question: 'What is IXO?',
        sessionId: mockSessionId,
      }),
    ).rejects.toThrow('IXO Guru API URL is not set');
  });

  it('should throw error when GURU_ASSISTANCE_API_TOKEN is not set', async () => {
    delete process.env.GURU_ASSISTANCE_API_TOKEN;

    await expect(
      askIXOGuruTool.invoke({
        question: 'What is IXO?',
        sessionId: mockSessionId,
      }),
    ).rejects.toThrow('Guru Assistance API token is not set');
  });

  it('should throw error when ORACLE_DID is not set', async () => {
    delete process.env.ORACLE_DID;

    await expect(
      askIXOGuruTool.invoke({
        question: 'What is IXO?',
        sessionId: mockSessionId,
      }),
    ).rejects.toThrow('Oracle DID is not set');
  });

  it('should throw error when API response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    } as FetchResponse);

    await expect(
      askIXOGuruTool.invoke({
        question: 'What is IXO?',
        sessionId: mockSessionId,
      }),
    ).rejects.toThrow('Error: Internal Server Error');
  });
});
