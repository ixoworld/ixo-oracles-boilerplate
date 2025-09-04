import z from 'zod';

export interface MessageDTO {
  content: string;
  role_type: 'user' | 'assistant' | 'system';
  name: string; // User name
  timestamp?: string;
}
export type SearchStrategy =
  | 'balanced'
  | 'diverse'
  | 'precise'
  | 'contextual'
  | 'recent_memory'
  | 'facts_only'
  | 'entities_only'
  | 'topics_only';
export interface Message {
  role: string;
  role_type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface SaveResponse {
  message: string;
  success: boolean;
}

export interface Fact {
  uuid: string;
  name: string;
  fact: string;
  created_at: string;
}

export type MemoryEngineQueryResponse = {
  request_event_id: string;
  results: EnhancedSearchResults;
};

export interface EnhancedSearchResults {
  facts: Array<{
    uuid: string;
    fact: string;
    source_node_uuid: string;
    target_node_uuid: string;
    created_at: string;
    valid_at: string;
    invalid_at: string | null;
  }>;
  entities: Array<{
    uuid: string;
    name: string;
    summary: string;
    labels: string[];
    group_id: string;
    created_at: string;
  }>;
  episodes: Array<{
    uuid: string;
    name: string;
    content: string;
    created_at: string;
    group_id: string;
  }>;
  communities: Array<{
    uuid: string;
    name: string;
    summary: string;
    created_at: string | null;
  }>;
}

export interface SearchResults {
  facts: Fact[];
}

export interface EpisodeDTO {
  episodeType: string;
  name: string;
  content: string;
  source_description: string;
  reference_time: string;
}

export interface SaveEpisodesRequest {
  oracle_did: string;
  user_did: string;
  episodes: EpisodeDTO[];
}

export enum MatrixMemoryEventType {
  MEMORY_QUERY = 'ixo.memory.query',
  MEMORY_RESULTS = 'ixo.memory.results',
  MEMORY_SAVE = 'ixo.memory.save',
  MEMORY_SAVE_EPISODES = 'ixo.memory.save_episodes',
  MEMORY_DELETE_ALL_MEMORIES = 'ixo.memory.delete_all_memories',
  MEMORY_BULK_SAVE = 'ixo.memory.bulk_save',
  MEMORY_LOG = 'ixo.memory.log',
  MEMORY_TASK = 'ixo.memory.task',
  MEMORY_TASK_UPDATE = 'ixo.memory.task.update',

  MEMORY_TASK_ACKNOWLEDGEMENT = 'ixo.memory.task.acknowledgement',
  MEMORY_TASK_ERROR = 'ixo.memory.task.error',
}
export interface MatrixMemoryQueryEventContent {
  query: string;
  userDid: string;
  strategy?: SearchStrategy;
  centerNodeUuid?: string;
  oracleDids: string[];
}
export interface MatrixMemorySaveEventContent {
  memory: string;
  oracleDid: string;
  userDid: string;
}
export interface MatrixMemorySaveEpisodesEventContent {
  episodes: EpisodeDTO[];
  userDid: string;
  oracleDid: string;
} // bulk save

export interface MatrixMemoryBulkSaveEventContent {
  memories: MessageDTO[];
  userDid: string;
  oracleDid: string;
}

export const MatrixMemoryDeleteAllMemoriesEventContentSchema = z.object({
  userDid: z.string(),
  oracleDid: z.string(),
});
export type MatrixMemoryDeleteAllMemoriesEventContent = z.infer<
  typeof MatrixMemoryDeleteAllMemoriesEventContentSchema
>;

export interface TaskErrorPayload {
  userDid?: string;
  error: string;
  eventId: string;
}