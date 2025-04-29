import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}

export class SendMessagePayload {
  stream?: boolean;
  message: string;
  sessionId: string;
  matrixAccessToken: string;
  did: string;
}
