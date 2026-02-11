import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { CallId } from './types';
import { OraclesCallMatrixEventContent } from './sync-call';

export class ListCallDto {
  @ApiProperty({
    description: 'Unique identifier for the session',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sessionId: string;

  @ApiProperty({
    description: 'Unique identifier for the user',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  userDid: string;

  homeServer?: string;
}

@ApiExtraModels(OraclesCallMatrixEventContent)
export class Call extends OraclesCallMatrixEventContent {
  @ApiProperty({
    description: 'Unique identifier for the call',
    example: '550e8400-e29b-41d4-a716-446655440000@lk-room-12345',
  })
  id: CallId;
}

@ApiExtraModels(OraclesCallMatrixEventContent)
export class ListCallResponse {
  @ApiProperty({
    description: 'Array of call events from Matrix',
    type: 'array',
    items: { $ref: getSchemaPath(Call) },
  })
  calls: OraclesCallMatrixEventContent[];
}

export const MATRIX_STATE_KEY_ORACLES_CALLS = '_oracles_calls_list';
/**
 * The state of the oracles calls list
 * ids list of the oracles calls encrypted events
 *
 */
export type MatrixOraclesCallsListState = {
  calls: {
    callId: CallId;
    sessionId: string;
  }[];
};
