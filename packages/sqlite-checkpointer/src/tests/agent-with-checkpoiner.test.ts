import {
  BaseLanguageModelCallOptions,
  BaseLanguageModelInput,
} from '@langchain/core/language_models/base';
import {
  BaseChatModel,
  BaseChatModelCallOptions,
  BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import {
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  MessageStructure,
} from '@langchain/core/messages';
import { ChatGeneration, ChatResult } from '@langchain/core/outputs';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import { createAgent } from 'langchain';
import { SqliteSaver } from '../index';

import { Runnable, RunnableLambda } from '@langchain/core/runnables';
import { MessagesZodMeta } from '@langchain/langgraph';
import { registry } from '@langchain/langgraph/zod';
import { z } from 'zod/v4-mini';

const State = z.object({
  messages: z
    .array(z.custom<BaseMessage>())
    .register(registry, MessagesZodMeta),
  extraField: z.number(),
});

// Mock Chat Model for testing without API calls
class MockChatModel extends BaseChatModel {
  responses: string[];
  callCount: number = 0;

  constructor(responses: string[] = []) {
    super({ cache: undefined });
    this.responses = responses;
  }

  async _generate(
    _messages: any[],
    _options?: BaseLanguageModelCallOptions | undefined,
  ): Promise<ChatResult> {
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;

    const message = new AIMessageChunk(response ?? '');
    const generation: ChatGeneration = {
      message,
      text: response ?? '',
    };

    return {
      generations: [generation],
    };
  }

  _llmType(): string {
    return 'mock';
  }

  override async invoke(_input: any, _config?: any): Promise<AIMessageChunk> {
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return new AIMessageChunk(response ?? '');
  }

  override bindTools(
    _tools: BindToolsInput[],
    _kwargs?: Partial<BaseChatModelCallOptions> | undefined,
  ): Runnable<
    BaseLanguageModelInput,
    AIMessageChunk<MessageStructure>,
    BaseChatModelCallOptions
  > {
    return new RunnableLambda({
      func: async (input: BaseLanguageModelInput) => {
        return new AIMessageChunk(input as string);
      },
    }) as Runnable<
      BaseLanguageModelInput,
      AIMessageChunk<MessageStructure>,
      BaseChatModelCallOptions
    >;
  }
}

describe('createAgent with SQLiteSaver Integration Tests', () => {
  let dbPath: string;
  let db: Database.Database;
  let checkpointer: SqliteSaver;
  let mockLlm: MockChatModel;

  beforeEach(() => {
    // Create temporary database
    dbPath = `./test_checkpoint_${Date.now()}.db`;
    db = new Database(dbPath);
    checkpointer = new SqliteSaver(db);

    // Mock LLM with predefined responses
    mockLlm = new MockChatModel([
      "I'll check the weather for you.",
      'The weather is sunny!',
      'Is there anything else?',
    ]);
  });

  afterEach(() => {
    // Cleanup
    db.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should persist agent state across multiple invocations', async () => {
    const agent = createAgent({
      model: mockLlm,
      tools: [],
      checkpointer,
      stateSchema: State,
    });

    const threadId = 'test_thread_1';
    const config = { configurable: { thread_id: threadId } };

    // First invocation
    const result1 = await agent.invoke(
      {
        messages: [new HumanMessage("What's the weather in NYC?")],
        extraField: 1,
      },
      config,
    );

    expect(result1).toBeDefined();
    expect(result1.messages).toBeDefined();
    expect(result1.messages.length).toBeGreaterThan(0);
    expect(result1.extraField).toBe(1);

    // Get initial state
    const state1 = await agent.graph.getState(config);

    expect(state1).toBeDefined();
    expect(state1.values.messages).toBeDefined();
    const initialMessageCount = state1.values.messages.length;

    // Second invocation with same thread_id
    const result2 = await agent.invoke(
      { messages: [new HumanMessage('And in San Francisco?')], extraField: 2 },
      config,
    );

    expect(result2).toBeDefined();

    // Verify state was persisted (should have more messages)
    const state2 = await agent.graph.getState(config);
    if (!state2) {
      throw new Error('State is undefined');
    }
    expect(state2.values.messages.length).toBeGreaterThan(initialMessageCount);
    expect(state2.values.extraField).toBe(2);
  });

  it('should maintain separate state for different thread IDs', async () => {
    const agent = createAgent({
      model: mockLlm,
      tools: [],
      checkpointer,
      stateSchema: State,
    });

    // First thread
    const config1 = { configurable: { thread_id: 'thread_1' } };
    await agent.invoke(
      { messages: [new HumanMessage('NYC weather?')], extraField: 77 },
      config1,
    );
    const state1 = await agent.graph.getState(config1);
    if (!state1) {
      throw new Error('State is undefined');
    }

    // Second thread
    const config2 = { configurable: { thread_id: 'thread_2' } };
    await agent.invoke(
      { messages: [new HumanMessage('London weather?')], extraField: 88 },
      config2,
    );
    const state2 = await agent.graph.getState(config2);
    if (!state2) {
      throw new Error('State is undefined');
    }

    // Both threads should exist independently
    expect(state1).toBeDefined();
    expect(state2).toBeDefined();
    expect(state1.values.messages.length).toBeGreaterThanOrEqual(1);
    expect(state2.values.messages.length).toBeGreaterThanOrEqual(1);
    expect(state1.values.extraField).toBe(77);
    expect(state2.values.extraField).toBe(88);
  });

  it('should persist data across agent instance recreation', async () => {
    const threadId = 'persistence_test';
    const config = { configurable: { thread_id: threadId } };

    // First agent instance
    let agent1 = createAgent({
      model: mockLlm,
      tools: [],
      stateSchema: State,
      checkpointer,
    });

    await agent1.invoke(
      { messages: [new HumanMessage('First conversation')], extraField: 113 },
      config,
    );

    const state1 = await agent1.graph.getState(config);
    if (!state1) {
      throw new Error('State is undefined');
    }
    const msgCount1 = state1.values.messages.length;

    // Second agent instance (simulating restart)
    const mockLlm2 = new MockChatModel([
      "I'll help you.",
      'Sure thing!',
      'Done!',
    ]);

    agent1 = createAgent({
      model: mockLlm2,
      tools: [],
      stateSchema: State,
      checkpointer,
    });

    // New agent should recover previous state
    const state2 = await agent1.graph.getState(config);
    if (!state2) {
      throw new Error('State is undefined');
    }
    expect(state2.values.messages.length).toBe(msgCount1);

    // Continue conversation
    await agent1.invoke(
      { messages: [new HumanMessage('Second conversation')], extraField: 114 },
      config,
    );

    const state3 = await agent1.graph.getState(config);
    if (!state3) {
      throw new Error('State is undefined');
    }
    expect(state3.values.messages.length).toBeGreaterThan(msgCount1);
  });
});
