import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import OpenAI from 'openai';
import {
  getChatOpenAiModel,
  getOpenAiEmbeddings,
  getRawOpenAiModel,
} from './openai';

// Mock environment variables
const originalEnv = process.env;

describe('OpenAI Models', () => {
  beforeEach(() => {
    jest.resetModules();
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
      expect(model).toHaveProperty('modelName', 'gpt-4o-mini');
      expect(model).toHaveProperty('apiKey', 'test-api-key');
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
      expect(model).toHaveProperty('modelName', 'gpt-4');
      expect(model).toHaveProperty('apiKey', 'custom-api-key');
    });
  });

  describe('getRawOpenAiModel', () => {
    it('should create an OpenAI instance with default parameters', () => {
      const model = getRawOpenAiModel();

      expect(model).toBeInstanceOf(OpenAI);
      expect(model).toHaveProperty('apiKey', 'test-api-key');
    });

    it('should override default parameters when provided', () => {
      const customParams = {
        apiKey: 'custom-api-key',
        organization: 'org-123',
      };

      const model = getRawOpenAiModel(customParams);

      expect(model).toBeInstanceOf(OpenAI);
      expect(model).toHaveProperty('apiKey', 'custom-api-key');
      expect(model).toHaveProperty('organization', 'org-123');
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
    it('should throw an error when OPENAI_API_KEY is not set', () => {
      delete process.env.OPENAI_API_KEY;

      expect(() => getChatOpenAiModel()).toThrow();
      expect(() => getRawOpenAiModel()).toThrow();
      expect(() => getOpenAiEmbeddings()).toThrow();
    });
  });
});
