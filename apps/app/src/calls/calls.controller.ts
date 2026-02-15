import {
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CallsService } from './calls.service';
import { StrictBody } from './decorators/strict-body.decorator';
import { ListCallResponse } from './dto/list-call';
import { SyncCallResponse } from './dto/sync-call';
import { CallId } from './dto/types';
import { UpdateCallDto } from './dto/update-dto';

@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post('/:callId/sync')
  @ApiOperation({ summary: 'Sync a call for a session with matrix state' })
  @ApiParam({
    name: 'callId',
    description: 'Unique identifier for the call',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 201,
    description: 'Call synced successfully',
    type: SyncCallResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'Call not found',
  })
  syncCall(
    @Param('callId') callId: CallId,
    @Req() req: Request,
  ): Promise<SyncCallResponse> {
    return this.callsService.syncCall({
      callId,
      userDid: req.authData.did,
    });
  }

  @Patch('/:callId/update')
  @ApiOperation({ summary: 'Update a call for a session with matrix state' })
  @ApiParam({
    name: 'callId',
    description: 'Unique identifier for the call',
    example: '550e8400-e29b-41d4-a716-446655440000@lk-room-12345',
  })
  @ApiResponse({
    status: 201,
    description: 'Call updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Call not found',
  })
  updateCall(
    @Param('callId') callId: CallId,
    @StrictBody(UpdateCallDto) body: UpdateCallDto,
    @Req() _req: Request,
  ) {
    return this.callsService.updateCall({
      callId,
      updateCallDto: body,
    });
  }

  @Get('/:callId/key')
  @ApiOperation({ summary: 'Get encryption key for a call' })
  @ApiParam({
    name: 'callId',
    description: 'Unique identifier for the call',
    example: '550e8400-e29b-41d4-a716-446655440000@lk-room-12345',
  })
  @ApiHeader({
    name: 'x-api-key',
    description:
      'API key for authentication between backend and live agent backend',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Encryption key returned successfully (encrypted)',
  })
  @ApiResponse({
    status: 404,
    description: 'Encryption key not found',
  })
  getEncryptionKey(
    @Param('callId') callId: CallId,
    @Headers('x-api-key') apiKey: string,
    @Req() _req: Request,
  ) {
    return this.callsService.getEncryptionKey({
      callId,
      apiKey,
    });
  }

  @Get('/session/:sessionId')
  @ApiOperation({ summary: 'Get a list of calls for a session' })
  @ApiParam({
    name: 'sessionId',
    description: 'Unique identifier for the session',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Calls returned successfully',
    type: ListCallResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'Calls not found',
  })
  getCalls(@Param('sessionId') sessionId: string, @Req() req: Request) {
    return this.callsService.listCalls({
      sessionId,
      userDid: req.authData.did,
      homeServer: req.authData.homeServer,
    });
  }
}
