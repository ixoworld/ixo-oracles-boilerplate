export interface IReasoningEvent {
  /**
   * The reasoning text content
   */
  reasoning: string;

  /**
   * Detailed reasoning information
   */
  reasoningDetails?: Array<{
    type: string;
    text: string;
  }>;

  /**
   * Whether this is a complete reasoning or partial chunk
   */
  isComplete?: boolean;

  /**
   * Timestamp when the reasoning was generated
   */
  timestamp?: string;
}

export const EVENT_NAME = 'reasoning' as const;
