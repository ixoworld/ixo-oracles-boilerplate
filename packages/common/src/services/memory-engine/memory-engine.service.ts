import { Logger } from '@ixo/logger';
import type {
  SearchEnhancedRequest,
  SearchEnhancedResponse,
  UserContextData,
} from './types.js';

export class MemoryEngineService {
  constructor(
    private readonly memoryEngineUrl: string,
    private readonly memoryServiceApiKey: string,
  ) {}

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
      // Execute all 6 queries in parallel
      const [identity, work, goals, interests, relationships, recent] =
        await Promise.all([
          this.queryIdentity(oracleDid, userDid, roomId),
          this.queryWork(oracleDid, userDid, roomId),
          this.queryGoals(oracleDid, userDid, roomId),
          this.queryInterests(oracleDid, userDid, roomId),
          this.queryRelationships(oracleDid, userDid, roomId),
          this.queryRecent(oracleDid, userDid, roomId),
        ]);

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
      query: 'user identity traits values personality characteristics',
      strategy: 'balanced',
      max_facts: 15,
      max_entities: 8,
      max_episodes: 5,
      max_communities: 3,
      knowledge_level: 'both',
      search_filters: {
        node_labels: [
          'Person',
          'Trait',
          'Value',
          'Identity',
          'Attribute',
          'Emotion',
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
      query: 'work job projects skills organization employment',
      strategy: 'balanced',
      max_facts: 15,
      max_entities: 8,
      max_episodes: 5,
      max_communities: 3,
      knowledge_level: 'both',
      search_filters: {
        node_labels: ['Job', 'Project', 'Organization', 'Skill', 'Tool'],
        edge_types: ['EmployedAt', 'WorksOn', 'Manages', 'Uses'],
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
      query: 'goals milestones habits routines patterns',
      strategy: 'balanced',
      max_facts: 12,
      max_entities: 6,
      max_episodes: 4,
      max_communities: 2,
      knowledge_level: 'both',
      search_filters: {
        node_labels: ['Goal', 'Milestone', 'Habit', 'Routine', 'Pattern'],
        edge_types: ['Pursuing', 'Achieved', 'Practices'],
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
      query: 'interests hobbies preferences likes dislikes',
      strategy: 'balanced',
      max_facts: 12,
      max_entities: 6,
      max_episodes: 4,
      max_communities: 2,
      knowledge_level: 'both',
      search_filters: {
        node_labels: ['Interest', 'Hobby', 'Preference', 'Product', 'Content'],
        edge_types: ['Prefers', 'Likes', 'Dislikes', 'InterestedIn'],
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
      query: 'relationships people connections social network',
      strategy: 'balanced',
      max_facts: 10,
      max_entities: 8,
      max_episodes: 3,
      max_communities: 2,
      knowledge_level: 'both',
      search_filters: {
        node_labels: ['Person'],
        edge_types: ['Knows', 'WorksWith', 'MemberOf', 'Influences'],
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
    const request: SearchEnhancedRequest = {
      oracle_dids: [oracleDid],
      query: 'recent conversations activities updates',
      strategy: 'recent_memory',
      max_facts: 8,
      max_entities: 4,
      max_episodes: 6,
      max_communities: 2,
      knowledge_level: 'both',
      search_filters: {
        created_at: [
          [{ date: '2024-01-01T00:00:00Z', comparison_operator: '>=' }],
        ],
      },
    };

    return this.executeQuery(request, userDid, oracleDid, roomId);
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
