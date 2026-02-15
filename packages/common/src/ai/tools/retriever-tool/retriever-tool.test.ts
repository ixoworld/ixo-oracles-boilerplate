import { type VectorDBDataStore } from '@ixo/data-store';
import { Document } from '@langchain/core/documents';
import { FakeChatModel } from '@langchain/core/utils/testing';
import { retrieverToolFactory } from './retriever-tool.js';

const fakeModel = new FakeChatModel({});

// Mock the logger to prevent console output during tests
vi.mock('@ixo/logger', () => ({
  Logger: {
    error: vi.fn(),
  },
}));

// Mock the OpenAI model
vi.mock('../../models/openai', () => ({
  getChatOpenAiModel: () => fakeModel,
}));

// Mock the doc relevance checker
vi.mock('../../utils/doc-relevance-checker', () => ({
  default: vi.fn().mockResolvedValue(true),
}));
const fakeDocRelevanceChecker = vi.fn().mockResolvedValue(true);

vi.spyOn(
  await import('../../utils/doc-relevance-checker'),
  'default',
).mockImplementation(fakeDocRelevanceChecker);

describe('RetrieverTool', () => {
  let mockStore: { queryWithSimilarity: ReturnType<typeof vi.fn> };
  const mockModel: FakeChatModel = new FakeChatModel({});

  beforeEach(() => {
    mockStore = {
      queryWithSimilarity: vi.fn(),
    };
  });

  it('should retrieve documents with default settings', async () => {
    const mockDocs = [
      { id: '1', content: 'test content 1', metadata: { source: 'test1' } },
      { id: '2', content: 'test content 2', metadata: { source: 'test2' } },
    ];

    mockStore.queryWithSimilarity.mockResolvedValue(mockDocs);

    const tool = retrieverToolFactory({
      store: mockStore as unknown as VectorDBDataStore,
    });
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
      store: mockStore as unknown as VectorDBDataStore,
      map: resultsMap,
      requestId,
    });

    await tool.invoke({ query: 'test query' });

    expect(resultsMap.get(requestId)).toEqual([{ source: 'test' }]);
  });

  it('should return undefined when no documents found', async () => {
    mockStore.queryWithSimilarity.mockResolvedValue([]);

    const tool = retrieverToolFactory({
      store: mockStore as unknown as VectorDBDataStore,
    });
    const result = await tool.invoke({ query: 'test query' });

    expect(result).toBeUndefined();
  });

  it('should check document relevance when similarity threshold is higher', async () => {
    const mockDocs = [
      { id: '1', content: 'test content', metadata: { source: 'test' } },
    ];
    mockStore.queryWithSimilarity.mockResolvedValue(mockDocs);

    const tool = retrieverToolFactory({
      store: mockStore as unknown as VectorDBDataStore,
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
    const docRelevanceModule = await import(
      '../../utils/doc-relevance-checker'
    );
    (
      docRelevanceModule.default as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('Test error'));

    const tool = retrieverToolFactory({
      store: mockStore as unknown as VectorDBDataStore,
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
      store: mockStore as unknown as VectorDBDataStore,
      filters,
    });

    await tool.invoke({ query: 'test query' });

    expect(mockStore.queryWithSimilarity).toHaveBeenCalledWith('test query', {
      similarityThreshold: 0.3,
      filters,
    });
  });
});
