import { type AllEvents } from '@ixo/oracles-events';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Socket } from 'socket.io';
import { WS_SERVICE_EVENT_NAME, wsEmitter } from './emitter';

@Injectable()
export class WsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WsService.name);
  private readonly sessionConnections = new Map<string, Set<Socket>>();

  /**
   * Add a WebSocket connection for a specific session
   */
  addClientConnection(sessionId: string, socket: Socket): void {
    if (!this.sessionConnections.has(sessionId)) {
      this.logger.log(`Creating new session for: ${sessionId}`);
      this.sessionConnections.set(sessionId, new Set());
    }

    const connections = this.sessionConnections.get(sessionId);
    connections?.add(socket);
    this.logger.log(
      `Added connection to session: ${sessionId}, total connections: ${connections?.size}`,
    );
  }

  /**
   * Publish an event to all connections in a specific session
   */
  publishToSession(sessionId: string, event: AllEvents): void {
    const connections = this.sessionConnections.get(sessionId);
    if (connections && connections.size > 0) {
      this.logger.log(
        `Publishing event to session: ${sessionId}, connections: ${connections.size}`,
      );
      connections.forEach((socket) => {
        if (socket.connected) {
          socket.emit('event', event);
        } else {
          // Remove disconnected socket
          connections.delete(socket);
        }
      });
    } else {
      this.logger.warn(
        `Attempted to publish to non-existent session: ${sessionId}`,
      );
    }
  }

  /**
   * Remove a client's connection when they disconnect
   */
  removeClientConnection(sessionId: string, socket: Socket): void {
    const connections = this.sessionConnections.get(sessionId);
    if (connections) {
      connections.delete(socket);
      this.logger.log(
        `Removed connection from session: ${sessionId}, remaining: ${connections.size}`,
      );

      // Clean up empty sessions
      if (connections.size === 0) {
        this.sessionConnections.delete(sessionId);
        this.logger.log(`Cleaned up empty session: ${sessionId}`);
      }
    }
  }

  /**
   * Get active sessions count for monitoring
   */
  getActiveSessionsCount(): number {
    return this.sessionConnections.size;
  }

  /**
   * Get total connections count for monitoring
   */
  getTotalConnectionsCount(): number {
    let total = 0;
    this.sessionConnections.forEach((connections) => {
      total += connections.size;
    });
    return total;
  }

  onModuleInit(): void {
    this.logger.log('WebSocket service initialized');
    wsEmitter.on(WS_SERVICE_EVENT_NAME, (event: AllEvents) => {
      this.publishToSession(event.payload.sessionId, event);
    });
  }

  onModuleDestroy(): void {
    this.logger.log('Cleaning up all WebSocket connections');
    this.sessionConnections.forEach((connections, sessionId) => {
      connections.forEach((socket) => {
        socket.disconnect();
      });
    });
    this.sessionConnections.clear();
  }
}
