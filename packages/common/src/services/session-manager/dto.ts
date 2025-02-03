import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UserAuthDto {
  @IsString()
  @IsNotEmpty()
  matrixAccessToken: string;

  @IsString()
  @IsNotEmpty()
  did: string;
}

export class ListChatSessionsDto extends UserAuthDto {}

export class CreateChatSessionDto extends UserAuthDto {
  @IsString()
  @IsNotEmpty()
  oracleName: string;
}

export class DeleteChatSessionDto extends UserAuthDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;
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
}

export class ListChatSessionsResponseDto {
  @IsArray()
  @IsNotEmpty()
  sessions: ChatSession[];
}

export class CreateChatSessionResponseDto extends ChatSession {}
