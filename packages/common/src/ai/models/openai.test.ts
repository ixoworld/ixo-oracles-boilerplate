import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { getChatOpenAiModel, getOpenAiEmbeddings } from './openai.js';

// Mock environment variables
const originalEnv = process.env;

describe('OpenAI Models', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getChatOpenAiModel', () => {
    it('should create a ChatOpenAI instance with default parameters', () => {
      const model = getChatOpenAiModel();

      expect(model).toBeInstanceOf(ChatOpenAI);
      expect(model).toHaveProperty('temperature', 0.2);
      expect(model).toHaveProperty('model', 'gpt-4o-mini');
    });

    it('should override default parameters when provided', () => {
      const customParams = {
        temperature: 0.8,
        model: 'gpt-4',
        apiKey: 'custom-api-key',
      };

      const model = getChatOpenAiModel(customParams);

      expect(model).toBeInstanceOf(ChatOpenAI);
      expect(model).toHaveProperty('temperature', 0.8);
      expect(model).toHaveProperty('model', 'gpt-4');
    });
  });

  describe('getOpenAiEmbeddings', () => {
    it('should create an OpenAIEmbeddings instance with default parameters', () => {
      const embeddings = getOpenAiEmbeddings();
      expect(embeddings).toBeInstanceOf(OpenAIEmbeddings);
      expect(embeddings.model).toEqual('text-embedding-3-small');
    });

    it('should override default parameters when provided', () => {
      const customParams = {
        model: 'text-embedding-ada-002',
        apiKey: 'custom-api-key',
      };

      const embeddings = getOpenAiEmbeddings(customParams);

      expect(embeddings).toBeInstanceOf(OpenAIEmbeddings);
      expect(embeddings.model).toEqual('text-embedding-ada-002');
    });
  });

  describe('Error handling', () => {
    it('should still create model when OPENAI_API_KEY is not set (validation deferred to call)', () => {
      delete process.env.OPENAI_API_KEY;

      // Newer @langchain/openai defers API key validation to invocation time
      const model = getChatOpenAiModel();
      expect(model).toBeInstanceOf(ChatOpenAI);
    });
  });
});
