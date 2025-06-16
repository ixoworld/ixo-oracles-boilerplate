import {
  type ListOracleMessagesResponse,
  SessionManagerService,
  transformGraphStateMessageToListMessageResponse,
} from '@ixo/common';
import { type IRunnableConfigWithRequiredFields } from '@ixo/matrix';
import { ToolCallEvent } from '@ixo/oracles-events';
import { type AIMessageChunk } from '@langchain/core/messages';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Response } from 'express';
import * as crypto from 'node:crypto';
import { CustomerSupportGraph } from 'src/graph';
import { type TCustomerSupportGraphState } from 'src/graph/state';
import { SseService } from 'src/sse/sse.service';
import { type ENV } from 'src/types';
import { type ListMessagesDto } from './dto/list-messages.dto';
import { type SendMessagePayload } from './dto/send-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly customerSupportGraph: CustomerSupportGraph,
    private readonly sessionManagerService: SessionManagerService,
    private readonly config: ConfigService<ENV>,
    private readonly sseService: SseService,
  ) {}
  public async listMessages(
    params: ListMessagesDto & {
      did: string;
      matrixAccessToken: string;
    },
  ): Promise<ListOracleMessagesResponse> {
    const { did, matrixAccessToken, sessionId } = params;
    if (!sessionId || !did || !matrixAccessToken) {
      throw new BadRequestException('Invalid parameters');
    }

    const { roomId } =
      await this.sessionManagerService.matrixManger.getOracleRoomId({
        userDid: did,
        oracleDid: this.config.getOrThrow('ORACLE_DID'),
      });

    if (!roomId) {
      throw new NotFoundException('Room not found or Invalid Session Id');
    }

    const config: IRunnableConfigWithRequiredFields & { sessionId: string } = {
      configurable: {
        thread_id: sessionId,
        configs: {
          matrix: {
            accessToken: matrixAccessToken,
            roomId,
            oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
          },
          user: {
            did,
          },
        },
      },
      sessionId,
    };
    const state = await this.customerSupportGraph.getGraphState(config);
    if (!state || (state.config.did && state.config.did !== did)) {
      return transformGraphStateMessageToListMessageResponse([]);
    }
    return transformGraphStateMessageToListMessageResponse(state.messages);
  }

  public async sendMessage(
    params: SendMessagePayload & {
      res?: Response;
    },
  ): Promise<
    | undefined
    | {
        message: {
          type: string;
          content: string;
          id: string;
        };
        sessionId: string;
      }
  > {
    const { runnableConfig, sessionId } = await this.prepareForQuery(params);

    if (params.stream && params.res) {
      // SET the headers

      params.res.set({
        'X-Request-Id': runnableConfig.configurable.requestId,
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Expose-Headers': 'X-Request-Id',
      });

      params.res.flushHeaders();

      const stream = await this.customerSupportGraph.streamMessage(
        params.message,
        runnableConfig,
        params.tools ?? [],
      );

      if (params.sessionId) {
        const toolCallEvent = new ToolCallEvent({
          requestId: runnableConfig.configurable.requestId ?? '',
          sessionId,
          toolName: 'toolName',
          args: 'args',
        });
        // const thinkingEvent = new ThinkingEvent({
        //   message: '',
        //   requestId: runnableConfig.configurable.requestId ?? '',
        //   sessionId,
        // });
        for await (const { data, event } of stream) {
          if (event === 'on_chat_model_stream') {
            const content = (data.chunk as AIMessageChunk).content;

            const toolCall = (data.chunk as AIMessageChunk).tool_calls;

            toolCall?.forEach((tool) => {
              // update toolCallEvent with toolCall
              toolCallEvent.payload.toolName = tool.name;
              toolCallEvent.payload.args = tool.args;
              this.sseService.publishToSession(sessionId, toolCallEvent);
            });

            if (!content) {
              continue;
            }
            params.res.write(content.toString());
            // // append content to fullContent
            // fullContent += content.toString();

            // filter.processChunk(
            //   content.toString(),
            //   (filteredContent) => {
            //     process.stdout.write(filteredContent);
            //     params.res?.write(filteredContent);
            //   },
            //   (filteredThinking) => {
            //     thinkingEvent.appendMessage(filteredThinking);
            //     this.sseService.publishToSession(sessionId, thinkingEvent);
            //   },
            // );
          }
        }
        // filter.flush(
        //   (filteredContent) => {
        //     params.res?.write(filteredContent);
        //   },
        //   (filteredThinking) => {
        //     thinkingEvent.appendMessage(filteredThinking);
        //     this.sseService.publishToSession(sessionId, thinkingEvent);
        //   },
        // );
        // if (!fullContent.includes('<answer>')) {
        //   // send the full content as a message
        //   params.res.write(fullContent);
        // }
        if (!params.res.writableEnded) {
          params.res.end();
        }
        return;
      }

      return;
    }

    const result = await this.customerSupportGraph.sendMessage(
      params.message,
      runnableConfig,
      params.tools ?? [],
    );
    const lastMessage = result.messages.at(-1);
    if (!lastMessage) {
      throw new BadRequestException('No message returned from the oracle');
    }

    return {
      message: {
        type: lastMessage.getType(),
        content: lastMessage.content.toString(),
        id: lastMessage.id ?? '',
      },
      sessionId,
    };
  }

  private async prepareForQuery(payload: SendMessagePayload): Promise<{
    sessionId: string;
    config: TCustomerSupportGraphState['config'];
    roomId: string;
    runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    };
  }> {
    const accessToken = payload.matrixAccessToken;
    const did = payload.did;
    const sessionId = payload.sessionId || crypto.randomUUID();
    const requestId =
      payload.stream && 'requestId' in payload
        ? (payload.requestId as string)
        : crypto.randomUUID();

    const { roomId } =
      await this.sessionManagerService.matrixManger.getOracleRoomId({
        userDid: did,
        oracleDid: this.config.getOrThrow('ORACLE_DID'),
      });
    if (!roomId) {
      throw new NotFoundException('Room not found or Invalid Session Id');
    }
    const { messages } = await this.listMessages({
      did,
      matrixAccessToken: accessToken,
      sessionId,
    });
    await this.sessionManagerService.syncSessionSet({
      sessionId,
      oracleName: this.config.getOrThrow('ORACLE_NAME'),
      did,
      messages: messages.map((message) => message.content),
      oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
    });

    const config: TCustomerSupportGraphState['config'] = {
      did: payload.did,
    };

    const runnableConfig: IRunnableConfigWithRequiredFields & {
      configurable: {
        sessionId: string;
      };
    } = {
      configurable: {
        requestId,
        sessionId,
        configs: {
          matrix: {
            accessToken,
            roomId,
            oracleDid: this.config.getOrThrow<string>('ORACLE_DID'),
          },
          user: {
            did,
          },
        },
      },
    };

    return {
      roomId,
      config,
      runnableConfig,
      sessionId,
    };
  }
}
