import { type KnowledgeStatusEnum } from '../dto/create-knowledge.dto';

/**
 * Knowledge entity representing a knowledge item in the database
 */
export interface IKnowledge {
  /**
   * Unique identifier for the knowledge item
   */
  id: string;

  /**
   * Title of the knowledge item
   */
  title: string;

  /**
   * Main content of the knowledge item
   */
  content: string;

  /**
   * Related links for the knowledge item
   */
  links?: string;

  /**
   * Questions associated with the knowledge item
   */
  questions?: string;

  /**
   * Number of content chunks created for vector embedding
   */
  number_of_chunks: number;

  /**
   * Current status of the knowledge item
   */
  status: KnowledgeStatusEnum;

  /**
   * Batch identifier for batch insert and openAI processing
   */
  batch_id?: string;

  /**
   * Date when the knowledge item was created
   */
  created_at: Date;

  /**
   * Date when the knowledge item was last updated
   */
  updated_at: Date;
}
