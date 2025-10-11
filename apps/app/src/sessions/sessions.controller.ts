import {
  type CreateChatSessionResponseDto,
  type ListChatSessionsResponseDto,
} from '@ixo/common';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new session' })
  @ApiResponse({ status: 201, description: 'Session created successfully.' })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request (e.g., missing/invalid headers by middleware, or session creation failed).',
  })
  async createSession(
    @Req() req: Request,
  ): Promise<CreateChatSessionResponseDto> {
    const { userOpenIdToken, did } = req.authData;
    return this.sessionsService.createSession({
      userOpenIdToken,
      did,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List all sessions for a user' })
  @ApiResponse({ status: 200, description: 'List of sessions retrieved.' })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request (e.g., missing/invalid headers by middleware, or failed to list sessions).',
  })
  async listSessions(
    @Req() req: Request,
  ): Promise<ListChatSessionsResponseDto> {
    const { userOpenIdToken: matrixAccessToken, did } = req.authData;
    return this.sessionsService.listSessions({ matrixAccessToken, did });
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a specific session' })
  @ApiParam({
    name: 'sessionId',
    required: true,
    description: 'ID of the session to delete',
  })
  @ApiResponse({ status: 200, description: 'Session deleted successfully.' })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request (e.g., missing/invalid headers by middleware, or failed to delete session).',
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found for the given ID.',
  })
  async deleteSession(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
  ): Promise<{ message: string }> {
    const { userOpenIdToken: matrixAccessToken, did } = req.authData;
    return this.sessionsService.deleteSession({
      matrixAccessToken,
      did,
      sessionId,
    });
  }
}
