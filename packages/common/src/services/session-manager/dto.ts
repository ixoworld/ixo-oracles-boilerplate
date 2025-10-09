import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UserAuthDto {
  @IsString()
  @IsNotEmpty()
  did: string;
}

export class ListChatSessionsDto extends UserAuthDto {
  @IsString()
  @IsNotEmpty()
  oracleEntityDid: string;
}

export class CreateChatSessionDto extends UserAuthDto {
  @IsString()
  @IsNotEmpty()
  oracleDid: string;

  @IsString()
  @IsNotEmpty()
  oracleEntityDid: string;

  @IsString()
  @IsNotEmpty()
  oracleName: string;
}

export class DeleteChatSessionDto extends UserAuthDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  oracleEntityDid: string;
}

export class ChatSession {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  lastUpdatedAt: string;

  @IsString()
  @IsNotEmpty()
  createdAt: string;

  @IsString()
  @IsNotEmpty()
  oracleName: string;

  @IsString()
  @IsNotEmpty()
  oracleDid: string;

  @IsString()
  @IsNotEmpty()
  oracleEntityDid: string;

  @IsNumber()
  @IsNotEmpty()
  lastProcessedCount?: number;
}

export class ListChatSessionsResponseDto {
  @IsArray()
  @IsNotEmpty()
  sessions: ChatSession[];
}

export class CreateChatSessionResponseDto extends ChatSession {}
