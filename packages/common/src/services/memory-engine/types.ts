// Complete TypeScript Response Types for /search-enhanced Endpoint

// Complete response type for /search-enhanced endpoint
export interface SearchEnhancedResponse {
  strategy_used: string;
  query: string;
  total_results: {
    facts: number;
    entities: number;
    episodes: number;
    communities: number;
  };
  facts: FactResult[];
  entities: EntityResult[];
  episodes: EpisodeResult[];
  communities: CommunityResult[];
}

// Individual result types
export interface FactResult {
  uuid: string;
  fact: string;
  source_node_uuid: string;
  target_node_uuid: string;
  created_at: string; // ISO 8601 datetime string
  valid_at: string | null; // ISO 8601 datetime string or null
  invalid_at: string | null; // ISO 8601 datetime string or null
}

export interface EntityResult {
  uuid: string;
  name: string;
  summary: string;
  labels: string[]; // Array of entity type labels
  group_id: string;
  created_at: string; // ISO 8601 datetime string
}

export interface EpisodeResult {
  uuid: string;
  name: string;
  content: string;
  created_at: string; // ISO 8601 datetime string
  group_id: string;
}

export interface CommunityResult {
  uuid: string;
  name: string;
  summary: string;
  created_at: string | null; // ISO 8601 datetime string or null
}

// Request type for /search-enhanced endpoint
export interface SearchEnhancedRequest {
  oracle_dids: string[]; // Array of oracle identifiers (1-5 items)
  query: string; // Search query string
  strategy?: SearchStrategy; // Optional, defaults to "balanced"
  max_facts?: number; // Optional, defaults to 10
  max_entities?: number; // Optional, defaults to 5
  max_episodes?: number; // Optional, defaults to 3
  max_communities?: number; // Optional, defaults to 2
  knowledge_level?: KnowledgeLevel; // Optional, defaults to "both"
  center_node_uuid?: string | null; // Optional UUID for contextual search
  search_filters?: SearchFilters | null; // Optional filters
}

// Search strategy enum
export type SearchStrategy =
  | 'balanced' // Default - fast, comprehensive
  | 'diverse' // Diverse results, avoid repetition
  | 'precise' // High-precision results
  | 'contextual' // Focus on specific entity (requires center_node_uuid)
  | 'recent_memory' // Recent conversations
  | 'facts_only' // Quick fact retrieval only
  | 'entities_only' // Entity lookup only
  | 'topics_only'; // Topic discovery only

// Knowledge level enum
export type KnowledgeLevel =
  | 'both' // Search both personal + shared knowledge (default)
  | 'user' // Search only personal/private memories
  | 'oracle'; // Search only shared oracle knowledge

// Search filters type
export interface SearchFilters {
  node_labels?: EntityType[] | null; // Array of entity type filters
  edge_types?: EdgeType[] | null; // Array of relationship type filters
  valid_at?: DateFilter[][] | null; // When event occurred
  invalid_at?: DateFilter[][] | null; // When fact stopped being true
  created_at?: DateFilter[][] | null; // When system learned the fact
  expired_at?: DateFilter[][] | null; // When system learned fact became invalid
}

// Date filter type
export interface DateFilter {
  date: string | null; // ISO 8601 datetime string or null
  comparison_operator: ComparisonOperator;
}

// Comparison operator enum
export type ComparisonOperator =
  | '=' // Equal to
  | '<>' // Not equal to
  | '>' // Greater than
  | '<' // Less than
  | '>=' // Greater than or equal
  | '<=' // Less than or equal
  | 'IS NULL' // Is null
  | 'IS NOT NULL'; // Is not null

// Entity types enum (from search_filters.py)
export type EntityType =
  | 'Person'
  | 'Trait'
  | 'Value'
  | 'Identity'
  | 'Attribute'
  | 'Emotion'
  | 'Stress'
  | 'CopingStrategy'
  | 'Job'
  | 'Project'
  | 'Skill'
  | 'Tool'
  | 'Organization'
  | 'Goal'
  | 'Milestone'
  | 'Habit'
  | 'Routine'
  | 'Pattern'
  | 'Interest'
  | 'Hobby'
  | 'Content'
  | 'Preference'
  | 'Product'
  | 'Expertise'
  | 'LearningGoal'
  | 'Resource'
  | 'Location'
  | 'Experience'
  | 'Event'
  | 'Group'
  | 'Pet'
  | 'CommunicationStyle'
  | 'Language'
  | 'Task'
  | 'Belief'
  | 'Cause'
  | 'Procedure';

// Edge types enum (from search_filters.py)
export type EdgeType =
  | 'Knows'
  | 'WorksWith'
  | 'Causes'
  | 'Enables'
  | 'Blocks'
  | 'PartOf'
  | 'BelongsTo'
  | 'Practices'
  | 'Uses'
  | 'Pursuing'
  | 'Requires'
  | 'Achieved'
  | 'EmployedAt'
  | 'WorksOn'
  | 'Manages'
  | 'LivesAt'
  | 'VisitedLocation'
  | 'LocatedIn'
  | 'Prefers'
  | 'Likes'
  | 'Dislikes'
  | 'InterestedIn'
  | 'ExpertiseIn'
  | 'Studying'
  | 'LearnedFrom'
  | 'Triggers'
  | 'Motivates'
  | 'ManagesVia'
  | 'Influences'
  | 'Supports'
  | 'MemberOf'
  | 'Owns'
  | 'CurrentlyIs'
  | 'WasPreviously'
  | 'AlignedWith'
  | 'ConflictsWith'
  | 'RelatesTo';

// HTTP Headers type
export interface SearchHeaders {
  Authorization: string; // "Bearer <matrix_openid_token>"
  'x-oracle-did': string; // Oracle identifier
  'x-room-id': string; // Matrix room ID
  'Content-Type': 'application/json';
}

// User context data structure
export interface UserContextData {
  identity?: SearchEnhancedResponse;
  work?: SearchEnhancedResponse;
  goals?: SearchEnhancedResponse;
  interests?: SearchEnhancedResponse;
  relationships?: SearchEnhancedResponse;
  recent?: SearchEnhancedResponse;
}
