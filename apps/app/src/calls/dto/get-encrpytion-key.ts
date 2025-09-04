import { ApiProperty } from '@nestjs/swagger';
import { CallId } from './types';

export class GetEncryptionKeyResponse {
  @ApiProperty({
    description: 'Encrypted key for secure call communication',
    example: 'a1b2c3d4e5f6789012345678901234567890abcdef...',
  })
  encryptionKey: string;

  @ApiProperty({
    description: 'Oracle did',
    example: 'did:ixo:1234567890',
  })
  oracleDid: string;
  @ApiProperty({
    description: 'User did',
    example: 'did:ixo:1234567890',
  })
  userDid: string;
}

export class GetEncryptionKeyDTO {
  @ApiProperty({
    description: 'Unique identifier for the call',
    example: '550e8400-e29b-41d4-a716-446655440000@lk-room-12345',
  })
  callId: CallId;

  @ApiProperty({
    description:
      'Api key for authentication between backend and live agent backend',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  apiKey: string;
}
