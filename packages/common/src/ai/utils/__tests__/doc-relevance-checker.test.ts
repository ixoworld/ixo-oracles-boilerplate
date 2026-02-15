import { Document } from '@langchain/core/documents';
import { type BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { FakeChatModel } from '@langchain/core/utils/testing';
import checkDocRelevance from '../doc-relevance-checker.js';

vi.spyOn(ChatPromptTemplate, 'fromTemplate');

describe('checkDocRelevance', () => {
  // Create a mock model that simulates relevance checking
  const createMockModel = (returnValue: boolean): BaseChatModel => {
    const mockModel = new FakeChatModel({});
    mockModel.withStructuredOutput = vi.fn().mockReturnValue({
      pipe: () => ({
        invoke: async () => ({ answer: returnValue }),
      }),
    });
    (
      ChatPromptTemplate.fromTemplate as ReturnType<typeof vi.fn>
    ).mockReturnValue({
      pipe: () => ({
        invoke: async () => ({ answer: returnValue }),
      }),
    });
    return mockModel;
  };

  it('should return true for relevant document using string input', async () => {
    const mockModel = createMockModel(true);

    const result = await checkDocRelevance({
      doc: 'This is a document about JavaScript programming',
      query: 'JavaScript development',
      model: mockModel,
    });
    expect(result).toBe(true);
  });

  it('should return false for irrelevant document using string input', async () => {
    const mockModel = createMockModel(false);
    const result = await checkDocRelevance({
      doc: 'This is a document about cooking recipes',
      query: 'JavaScript development',
      model: mockModel,
    });
    expect(result).toBe(false);
  });

  it('should handle Document object input', async () => {
    const mockModel = createMockModel(true);
    const doc = new Document({
      pageContent: 'This is a document about TypeScript',
      metadata: { id: '1' },
    });
    const result = await checkDocRelevance({
      doc,
      query: 'TypeScript features',
      model: mockModel,
    });
    expect(result).toBe(true);
  });

  it('should work with empty document content', async () => {
    const mockModel = createMockModel(false);
    const result = await checkDocRelevance({
      doc: '',
      query: 'Any query',
      model: mockModel,
    });
    expect(result).toBe(false);
  });

  it('should work with empty query', async () => {
    const mockModel = createMockModel(false);
    const result = await checkDocRelevance({
      doc: 'Some content',
      query: '',
      model: mockModel,
    });
    expect(result).toBe(false);
  });

  it('should handle special characters in document and query', async () => {
    const mockModel = createMockModel(true);
    const result = await checkDocRelevance({
      doc: 'Content with \n newlines and \t tabs',
      query: 'Query with \n newlines',
      model: mockModel,
    });
    expect(result).toBe(true);
  });
});
