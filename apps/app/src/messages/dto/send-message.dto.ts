import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class BrowserToolCallDto {
  @ApiProperty({
    description: 'The tool name',
    required: true,
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    description: 'The tool schema to be passed to the LLM',
    required: true,
    type: Object,
  })
  @IsNotEmpty()
  @IsObject()
  schema: Record<string, unknown>;

  @ApiProperty({
    description: 'The tool description to be passed to the LLM',
    required: true,
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  description: string;
}

export class AgActionDto {
  @ApiProperty({
    description: 'The action name',
    required: true,
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    description: 'The action description to be passed to the LLM',
    required: true,
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({
    description: 'The action parameters schema to be passed to the LLM',
    required: true,
    type: Object,
  })
  @IsNotEmpty()
  @IsObject()
  schema: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether this action has a render function',
    required: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  hasRender?: boolean;
}

export class SendMessageDto {
  @ApiProperty({
    description: 'Whether to stream the response',
    required: false,
    default: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @ApiProperty({
    description: 'The message content to be sent',
    required: true,
    example: 'Hello, how can I get help with my account?',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  message: string;

  @ApiProperty({
    description: 'The tool list to be passed to the LLM',
    required: false,
    type: [BrowserToolCallDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BrowserToolCallDto)
  tools?: BrowserToolCallDto[];

  @ApiProperty({
    description: 'The AG-UI action list to be passed to the LLM',
    required: false,
    type: [AgActionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgActionDto)
  agActions?: AgActionDto[];

  @ApiProperty({
    description: 'The metadata to be passed to the LLM',
    required: false,
    type: Object,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> & { editorRoomId?: string };

  @ApiProperty({
    description: 'User timezone (e.g., "America/New_York" or "UTC-5")',
    required: false,
    type: String,
    example: 'America/New_York',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class SendMessagePayload {
  stream?: boolean;
  message: string;
  sessionId: string;
  did: string;
  tools?: BrowserToolCallDto[];
  agActions?: AgActionDto[];
  userMatrixOpenIdToken: string;
  timezone?: string;

  metadata?: {
    editorRoomId?: string;
    currentEntityDid?: string;
  };
}

export class AbortRequestDto {
  @ApiProperty({
    description: 'The session ID to abort',
    required: true,
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  sessionId: string;
}
