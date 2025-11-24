import { Logger } from '@ixo/logger';
import type {
  SearchEnhancedRequest,
  SearchEnhancedResponse,
  UserContextData,
} from './types.js';

export class MemoryEngineService {
  private readonly QUERY_TIMEOUT_MS = 2500; // 2.5 seconds per query

  constructor(
    private readonly memoryEngineUrl: string,
    private readonly memoryServiceApiKey: string,
  ) {}

  /**
   * Wraps a promise with a timeout, returning fallback value if timeout is exceeded
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: T,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) =>
        setTimeout(() => resolve(fallback), timeoutMs),
      ),
    ]);
  }

  /**
   * Gather user context from Memory Engine by executing 6 parallel queries
   */
  async gatherUserContext(params: {
    oracleDid: string;
    userDid: string;
    roomId: string;
  }): Promise<UserContextData> {
    const { oracleDid, userDid, roomId } = params;

    Logger.info(
      `[MemoryEngineService] Gathering user context for oracle: ${oracleDid}, room: ${roomId}`,
    );

    try {
      // Execute all 6 queries in parallel with timeouts using Promise.allSettled
      const results = await Promise.allSettled([
        this.withTimeout(
          this.queryIdentity(oracleDid, userDid, roomId),
          this.QUERY_TIMEOUT_MS,
          undefined,
        ),
        this.withTimeout(
          this.queryWork(oracleDid, userDid, roomId),
          this.QUERY_TIMEOUT_MS,
          undefined,
        ),
        this.withTimeout(
          this.queryGoals(oracleDid, userDid, roomId),
          this.QUERY_TIMEOUT_MS,
          undefined,
        ),
        this.withTimeout(
          this.queryInterests(oracleDid, userDid, roomId),
          this.QUERY_TIMEOUT_MS,
          undefined,
        ),
        this.withTimeout(
          this.queryRelationships(oracleDid, userDid, roomId),
          this.QUERY_TIMEOUT_MS,
          undefined,
        ),
        this.withTimeout(
          this.queryRecent(oracleDid, userDid, roomId),
          this.QUERY_TIMEOUT_MS,
          undefined,
        ),
      ]);

      // Extract results from Promise.allSettled outcomes
      const identity =
        results[0].status === 'fulfilled' ? results[0].value : undefined;
      const work =
        results[1].status === 'fulfilled' ? results[1].value : undefined;
      const goals =
        results[2].status === 'fulfilled' ? results[2].value : undefined;
      const interests =
        results[3].status === 'fulfilled' ? results[3].value : undefined;
      const relationships =
        results[4].status === 'fulfilled' ? results[4].value : undefined;
      const recent =
        results[5].status === 'fulfilled' ? results[5].value : undefined;

      // Log any failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          Logger.warn(
            `[MemoryEngineService] Query ${index} failed:`,
            result.reason,
          );
        }
      });

      return {
        identity,
        work,
        goals,
        interests,
        relationships,
        recent,
      };
    } catch (error) {
      Logger.error(
        '[MemoryEngineService] Failed to gather user context:',
        error,
      );
      // Return empty context on error
      return {};
    }
  }

  /**
   * Query 1: User Identity & Attributes
   */
  private async queryIdentity(
    oracleDid: string,
    userDid: string,
    roomId: string,
  ): Promise<SearchEnhancedResponse | undefined> {
    const request: SearchEnhancedRequest = {
      oracle_dids: [oracleDid],
      query:
        'username and nickname and age user identity traits values personality characteristics communication style beliefs preferences',
      strategy: 'balanced',
      max_facts: 10,
      max_entities: 6,
      max_episodes: 3,
      max_communities: 2,
      knowledge_level: 'both',
      search_filters: {
        node_labels: [
          'Person',
          'Trait',
          'Value',
          'Identity',
          'Attribute',
          'Emotion',
          'Belief',
          'CommunicationStyle',
        ],
        invalid_at: [[{ date: null, comparison_operator: 'IS NULL' }]],
      },
    };

    return this.executeQuery(request, userDid, oracleDid, roomId);
  }

  /**
   * Query 2: Work Context
   */
  private async queryWork(
    oracleDid: string,
    userDid: string,
    roomId: string,
  ): Promise<SearchEnhancedResponse | undefined> {
    const request: SearchEnhancedRequest = {
      oracle_dids: [oracleDid],
      query:
        'work job career projects skills organization employment role responsibilities expertise',
      strategy: 'balanced',
      max_facts: 10,
      max_entities: 6,
      max_episodes: 3,
      max_communities: 2,
      knowledge_level: 'both',
      search_filters: {
        node_labels: [
          'Job',
          'Project',
          'Organization',
          'Skill',
          'Tool',
          'Expertise',
          'Task',
        ],
        edge_types: [
          'EmployedAt',
          'WorksOn',
          'Manages',
          'Uses',
          'ExpertiseIn',
          'WorksWith',
        ],
        invalid_at: [[{ date: null, comparison_operator: 'IS NULL' }]],
      },
    };

    return this.executeQuery(request, userDid, oracleDid, roomId);
  }

  /**
   * Query 3: Goals & Habits
   */
  private async queryGoals(
    oracleDid: string,
    userDid: string,
    roomId: string,
  ): Promise<SearchEnhancedResponse | undefined> {
    const request: SearchEnhancedRequest = {
      oracle_dids: [oracleDid],
      query:
        'goals aspirations objectives milestones habits routines patterns achievements progress',
      strategy: 'balanced',
      max_facts: 8,
      max_entities: 4,
      max_episodes: 3,
      max_communities: 1,
      knowledge_level: 'both',
      search_filters: {
        node_labels: [
          'Goal',
          'Milestone',
          'Habit',
          'Routine',
          'Pattern',
          'LearningGoal',
        ],
        edge_types: ['Pursuing', 'Achieved', 'Practices', 'Motivates'],
        invalid_at: [[{ date: null, comparison_operator: 'IS NULL' }]],
      },
    };

    return this.executeQuery(request, userDid, oracleDid, roomId);
  }

  /**
   * Query 4: Interests & Preferences
   */
  private async queryInterests(
    oracleDid: string,
    userDid: string,
    roomId: string,
  ): Promise<SearchEnhancedResponse | undefined> {
    const request: SearchEnhancedRequest = {
      oracle_dids: [oracleDid],
      query:
        'interests hobbies passions preferences likes dislikes expertise topics content',
      strategy: 'balanced',
      max_facts: 8,
      max_entities: 4,
      max_episodes: 3,
      max_communities: 1,
      knowledge_level: 'both',
      search_filters: {
        node_labels: [
          'Interest',
          'Hobby',
          'Preference',
          'Product',
          'Content',
          'Expertise',
          'Resource',
        ],
        edge_types: [
          'Prefers',
          'Likes',
          'Dislikes',
          'InterestedIn',
          'ExpertiseIn',
        ],
        invalid_at: [[{ date: null, comparison_operator: 'IS NULL' }]],
      },
    };

    return this.executeQuery(request, userDid, oracleDid, roomId);
  }

  /**
   * Query 5: Relationships
   */
  private async queryRelationships(
    oracleDid: string,
    userDid: string,
    roomId: string,
  ): Promise<SearchEnhancedResponse | undefined> {
    const request: SearchEnhancedRequest = {
      oracle_dids: [oracleDid],
      query:
        'relationships people connections social network colleagues friends family contacts',
      strategy: 'balanced',
      max_facts: 6,
      max_entities: 6,
      max_episodes: 2,
      max_communities: 1,
      knowledge_level: 'both',
      search_filters: {
        node_labels: ['Person', 'Group'],
        edge_types: [
          'Knows',
          'WorksWith',
          'MemberOf',
          'Influences',
          'Supports',
          'RelatesTo',
        ],
        invalid_at: [[{ date: null, comparison_operator: 'IS NULL' }]],
      },
    };

    return this.executeQuery(request, userDid, oracleDid, roomId);
  }

  /**
   * Query 6: Recent Context
   */
  private async queryRecent(
    oracleDid: string,
    userDid: string,
    roomId: string,
  ): Promise<SearchEnhancedResponse | undefined> {
    // Calculate date 90 days ago for recent context
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateString = ninetyDaysAgo.toISOString();

    const request: SearchEnhancedRequest = {
      oracle_dids: [oracleDid],
      query:
        'recent conversations messages discussions activities updates interactions',
      strategy: 'recent_memory',
      max_facts: 8,
      max_entities: 4,
      max_episodes: 6,
      max_communities: 2,
      knowledge_level: 'both',
      search_filters: {
        created_at: [[{ date: dateString, comparison_operator: '>=' }]],
      },
    };

    return this.executeQuery(request, userDid, oracleDid, roomId);
  }

  /**
   * Process conversation history by sending messages to the Memory Engine
   */
  async processConversationHistory({
    messages,
    userDid,
    oracleDid,
    roomId,
  }: {
    messages: Array<{
      content: string;
      role_type: 'user' | 'assistant' | 'system';
      role?: string;
      name?: string;
      source_description?: string;
    }>;
    userDid: string;
    oracleDid: string;
    roomId: string;
  }): Promise<{ success: boolean }> {
    if (!userDid) {
      Logger.warn(
        `[MemoryEngineService] No user DID provided, skipping conversation processing`,
      );
      return { success: false };
    }
    if (!oracleDid) {
      Logger.warn(
        `[MemoryEngineService] No oracle did provided, skipping conversation processing`,
      );
      return { success: false };
    }
    if (!roomId) {
      Logger.warn(
        `[MemoryEngineService] No room id provided, skipping conversation processing`,
      );
      return { success: false };
    }
    if (!messages || messages.length === 0) {
      Logger.info(
        `[MemoryEngineService] No messages to process for room ${roomId}`,
      );
      return { success: true };
    }

    try {
      const response = await fetch(`${this.memoryEngineUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-user-did': userDid,
          'x-oracle-did': oracleDid,
          'x-room-id': roomId,
          'x-service-api-key': this.memoryServiceApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        Logger.warn(
          `[MemoryEngineService] Memory Engine conversation processing failed (${response.status}): ${errorText}`,
        );
        return { success: false };
      }

      Logger.info(
        `[MemoryEngineService] Successfully processed ${messages.length} messages for room ${roomId}`,
      );
      return { success: true };
    } catch (error) {
      Logger.error(
        `[MemoryEngineService] Failed to process conversation history for room ${roomId}:`,
        error,
      );
      return { success: false };
    }
  }

  /**
   * Execute a search query against the Memory Engine API
   */
  private async executeQuery(
    request: SearchEnhancedRequest,
    userDid: string,
    oracleDid: string,
    roomId: string,
  ): Promise<SearchEnhancedResponse | undefined> {
    if (!userDid) {
      Logger.warn(
        `[MemoryEngineService] No user DID provided, skipping query "${request.query}"`,
      );
      return undefined;
    }
    if (!oracleDid) {
      Logger.warn(
        `[MemoryEngineService] No oracle did provided, skipping query "${request.query}"`,
      );
      return undefined;
    }
    if (!roomId) {
      Logger.warn(
        `[MemoryEngineService] No room id provided, skipping query "${request.query}"`,
      );
      return undefined;
    }

    try {
      const response = await fetch(`${this.memoryEngineUrl}/search-enhanced`, {
        method: 'POST',
        headers: {
          'x-user-did': userDid,
          'x-oracle-did': oracleDid,
          'x-room-id': roomId,
          'x-service-api-key': this.memoryServiceApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        Logger.warn(
          `[MemoryEngineService] Memory Engine query failed (${response.status}): ${errorText}`,
        );
        return undefined;
      }

      const result = (await response.json()) as SearchEnhancedResponse;
      Logger.info(
        `[MemoryEngineService] Query "${request.query}" returned ${result.total_results.facts} facts, ${result.total_results.entities} entities`,
      );
      return result;
    } catch (error) {
      Logger.error(
        `[MemoryEngineService] Failed to execute query "${request.query}":`,
        error,
      );
      return undefined;
    }
  }
}
