import { GraphEventEmitter, rootEventEmitter } from '@ixo/oracles-events';
import { Logger } from '@nestjs/common';

import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WsService } from './ws.service';

interface ISocketData {
  sessionId: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/',
})
export class WsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WsGateway.name);

  constructor(private readonly wsService: WsService) {}

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');
    // Register all events from the events package with this server
    GraphEventEmitter.registerEventHandlers(this.server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const sessionId = client.handshake.query.sessionId;
    const userDid = client.handshake.query.userDid;

    if (!sessionId || !userDid) {
      this.logger.error(
        `WebSocket connection attempt without ${sessionId ? 'sessionId' : ''} and ${userDid ? 'userDid' : ''} from ${client.id}`,
      );
      client.disconnect();
      return;
    }

    this.logger.log(
      `WebSocket connection established for session: ${sessionId}, client: ${client.id}`,
    );

    // Join the sessionId room (channel) - this is the key integration!
    await client.join(sessionId);

    // Also track in our service for monitoring
    this.wsService.addClientConnection(sessionId as string, client);

    // Send connection confirmation
    client.emit('connected', {
      message: 'Connected successfully',
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket): void {
    const sessionId = (client.data as ISocketData).sessionId;

    if (sessionId) {
      this.logger.log(
        `WebSocket connection closed for session: ${sessionId}, client: ${client.id}`,
      );
      this.wsService.removeClientConnection(sessionId, client);
    } else {
      this.logger.warn(
        `WebSocket disconnected without sessionId: ${client.id}`,
      );
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): void {
    client.emit('pong', {
      timestamp: new Date().toISOString(),
      sessionId: (client.data as ISocketData).sessionId,
    });
  }

  @SubscribeMessage('status')
  handleStatus(@ConnectedSocket() client: Socket): void {
    client.emit('status', {
      connected: true,
      sessionId: (client.data as ISocketData).sessionId,
      activeSessions: this.wsService.getActiveSessionsCount(),
      totalConnections: this.wsService.getTotalConnectionsCount(),
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('tool_result')
  @ApiOperation({
    summary: 'Handle Tool Result',
    description:
      'Receive tool execution result from client and forward to LangGraph',
  })
  @ApiResponse({
    status: 200,
    description: 'Tool result received successfully',
  })
  handleToolResult(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { toolCallId: string; result: any; error?: string },
  ): void {
    const sessionId = (client.data as ISocketData).sessionId;

    this.logger.log(
      `Tool result received for session: ${sessionId}, toolCallId: ${data.toolCallId}`,
    );

    // Emit result back to LangGraph via rootEventEmitter
    rootEventEmitter.emit('browser_tool_result', {
      sessionId,
      toolCallId: data.toolCallId,
      result: data.result,
      error: data.error,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('list-events')
  @ApiOperation({
    summary: 'List Available Events',
    description: 'Get a list of all available WebSocket events',
  })
  @ApiResponse({
    status: 200,
    description: 'List of available events',
  })
  handleListEvents(@ConnectedSocket() client: Socket): void {
    client.emit('available-events', {
      clientEvents: [
        'ping',
        'status',
        'subscribe',
        'list-events',
        'tool_result',
      ],
      serverEvents: [
        'connected',
        'pong',
        'status',
        'subscribed',
        'available-events',
        // LangGraph events
        'render_component',
        'tool_call',
        'browser_tool_call',
        'router_update',
        'message_cache_invalidation',
      ],
      sessionId: (client.data as ISocketData).sessionId,
      timestamp: new Date().toISOString(),
    });
  }
}
