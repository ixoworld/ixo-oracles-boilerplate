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
}

export class SendMessagePayload {
  stream?: boolean;
  message: string;
  sessionId: string;
  did: string;
  tools?: BrowserToolCallDto[];
  userMatrixOpenIdToken: string;
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
