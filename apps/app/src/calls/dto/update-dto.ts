import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { type CallId } from './types';

export class UpdateCallDto {
  @IsString()
  @IsOptional()
  @IsEnum(['active', 'ended'])
  callStatus?: 'active' | 'ended';

  @IsString()
  @IsOptional()
  @IsISO8601()
  callEndedAt?: string; // Ex: 2021-01-01T00:00:00.000Z

  @IsString()
  @IsOptional()
  @IsISO8601() // Ex: 2021-01-01T00:00:00.000Z
  callStartedAt?: string;
}

export interface UpdateCallResponse {
  callId: CallId;
  callStatus: 'active' | 'ended';
}
