import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

@ApiTags('messages')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get(':sessionId')
  @ApiOperation({ summary: 'List messages in a session' })
  @ApiParam({
    name: 'sessionId',
    required: true,
    description: 'ID of the session to list messages for',
  })
  @ApiResponse({ status: 200, description: 'Messages retrieved successfully.' })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g., missing/invalid parameters).',
  })
  @ApiResponse({
    status: 404,
    description: 'Room not found or User not in room.',
  })
  async listMessages(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
  ) {
    const { userOpenIdToken: matrixAccessToken, did } = req.authData;
    return this.messagesService.listMessages({
      sessionId,
      matrixAccessToken,
      did,
    });
  }

  @Post(':sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message to the oracle' })
  @ApiParam({
    name: 'sessionId',
    required: true,
    description: 'ID of the session to send a message to',
  })
  @ApiResponse({ status: 200, description: 'Message sent successfully.' })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g., missing/invalid parameters).',
  })
  async sendMessage(
    @Req() req: Request,
    @Body() sendMessageDto: SendMessageDto,
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ) {
    const { did } = req.authData;

    // Build the payload
    const payload = {
      ...sendMessageDto,

      did,
      sessionId,
    };

    // Handle streaming response if stream is true
    if (sendMessageDto.stream) {
      await this.messagesService.sendMessage({
        ...payload,
        res,
      });
      // The response is handled inside the service when streaming
    } else {
      // Regular response without streaming
      const result = await this.messagesService.sendMessage(payload);
      return res.status(HttpStatus.OK).json(result);
    }
  }
}
