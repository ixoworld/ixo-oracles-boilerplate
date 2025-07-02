import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum KnowledgeStatusEnum {
  /**
   * Row just inserted
   */
  INSERTED = 'inserted',
  /**
   * Embedding done
   */
  AI_EMBEDDED = 'ai_embedded',

  /**
   * In queue for embedding
   */
  IN_QUEUE = 'in_queue',

  /**
   * Processing
   */
  PROCESSING = 'processing',

  /**
   * Waiting for review
   */
  PENDING_REVIEW = 'pending_review',
  /**
   * Review passed
   */
  APPROVED = 'approved',
}

export class CreateKnowledgeDto {
  @ApiProperty({
    description: 'The title of the knowledge item',
    example: 'How to connect to the API',
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    description: 'The content of the knowledge item',
    example: 'To connect to the API, you need to use the provided API key...',
  })
  @IsNotEmpty()
  @IsString()
  content: string;

  @ApiPropertyOptional({
    description: 'Related links for the knowledge item',
    example: 'https://api.example.com/docs, https://github.com/example/repo',
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  links?: string;

  @ApiPropertyOptional({
    description: 'Questions associated with the knowledge item',
    example: 'How do I get an API key? What endpoints are available?',
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  questions?: string;
}
