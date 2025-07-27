import { type VectorDBDataStore } from '@ixo/data-store';
import { Document } from '@langchain/core/documents';
import { FakeChatModel } from '@langchain/core/utils/testing';
import { retrieverToolFactory } from './retriever-tool.js';

const fakeModel = new FakeChatModel({});

// Mock the logger to prevent console output during tests
jest.mock('@ixo/logger', () => ({
  Logger: {
    error: jest.fn(),
  },
}));

// Mock the OpenAI model
jest.mock('../../models/openai', () => ({
  getChatOpenAiModel: () => fakeModel,
}));

// Mock the doc relevance checker
jest.mock('../../utils/doc-relevance-checker', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));
const fakeDocRelevanceChecker = jest.fn().mockResolvedValue(true);

jest
  .spyOn(require('../../utils/doc-relevance-checker'), 'default')
  .mockImplementation(fakeDocRelevanceChecker);

describe('RetrieverTool', () => {
  let mockStore: jest.Mocked<VectorDBDataStore>;
  let mockModel: FakeChatModel;

  beforeEach(() => {
    mockStore = {
      queryWithSimilarity: jest.fn(),
    } as unknown as jest.Mocked<VectorDBDataStore>;
  });

  it('should retrieve documents with default settings', async () => {
    const mockDocs = [
      { id: '1', content: 'test content 1', metadata: { source: 'test1' } },
      { id: '2', content: 'test content 2', metadata: { source: 'test2' } },
    ];

    mockStore.queryWithSimilarity.mockResolvedValue(mockDocs);

    const tool = retrieverToolFactory({ store: mockStore });
    const result = (await tool.invoke({ query: 'test query' })) as Document[];

    expect(mockStore.queryWithSimilarity).toHaveBeenCalledWith('test query', {
      similarityThreshold: 0.3,
      filters: undefined,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Document);
    expect(result[0]?.pageContent).toBe('test content 1');
    expect(result[0]?.metadata).toEqual({ source: 'test1' });

    expect(fakeDocRelevanceChecker).toHaveBeenCalledWith({
      doc: result[0],
      query: 'test query',
      model: fakeModel,
    });
  });

  it('should store results in provided map', async () => {
    const mockDocs = [
      { id: '1', content: 'test content', metadata: { source: 'test' } },
    ];
    mockStore.queryWithSimilarity.mockResolvedValue(mockDocs);

    const resultsMap = new Map();
    const requestId = 'test-request-id';

    const tool = retrieverToolFactory({
      store: mockStore,
      map: resultsMap,
      requestId,
    });

    await tool.invoke({ query: 'test query' });

    expect(resultsMap.get(requestId)).toEqual([{ source: 'test' }]);
  });

  it('should return undefined when no documents found', async () => {
    mockStore.queryWithSimilarity.mockResolvedValue([]);

    const tool = retrieverToolFactory({ store: mockStore });
    const result = await tool.invoke({ query: 'test query' });

    expect(result).toBeUndefined();
  });

  it('should check document relevance when similarity threshold is higher', async () => {
    const mockDocs = [
      { id: '1', content: 'test content', metadata: { source: 'test' } },
    ];
    mockStore.queryWithSimilarity.mockResolvedValue(mockDocs);

    const tool = retrieverToolFactory({
      store: mockStore,
      similarThreshold: 0.5,
      model: mockModel,
    });

    const result = await tool.invoke({ query: 'test query' });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Document);
  });

  it('should handle errors during relevance checking', async () => {
    const mockDocs = [
      { id: '1', content: 'test content', metadata: { source: 'test' } },
    ];
    mockStore.queryWithSimilarity.mockResolvedValue(mockDocs);

    // Mock the relevance checker to throw an error
    jest
      .requireMock('../../utils/doc-relevance-checker')
      .default.mockRejectedValueOnce(new Error('Test error'));

    const tool = retrieverToolFactory({
      store: mockStore,
      similarThreshold: 0.5,
      model: mockModel,
    });

    const result = await tool.invoke({ query: 'test query' });

    expect(result).toHaveLength(0);
  });

  it('should apply filters when provided', async () => {
    const mockDocs = [
      { id: '1', content: 'test content', metadata: { source: 'test' } },
    ];
    mockStore.queryWithSimilarity.mockResolvedValue(mockDocs);
    const filters = { category: 'test' };
    const tool = retrieverToolFactory({
      store: mockStore,
      filters,
    });

    await tool.invoke({ query: 'test query' });

    expect(mockStore.queryWithSimilarity).toHaveBeenCalledWith('test query', {
      similarityThreshold: 0.3,
      filters,
    });
  });
});
