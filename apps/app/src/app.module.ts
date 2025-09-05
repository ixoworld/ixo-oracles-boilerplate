import {
  Logger,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EnvSchema } from './config';
import { MessagesModule } from './messages/messages.module';
import { AuthHeaderMiddleware } from './middleware/auth-header.middleware';
// import { QueueModule } from './queue/queue.module';
import { CallsModule } from './calls/calls.module';
import { SessionsModule } from './sessions/sessions.module';
import { SlackModule } from './slack/slack.module';
import { SseModule } from './sse/sse.module';
import { normalizeDid } from './utils/header.utils';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const result = EnvSchema.safeParse(config);
        if (!result.success) {
          // Log detailed errors
          Logger.error('Environment variable validation failed:', result.error);
          throw result.error;
        }
        const ORACLE_DID = normalizeDid(
          result.data.MATRIX_ORACLE_ADMIN_USER_ID,
        );
        return {
          ...result.data,
          ORACLE_DID,
        };
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // Time-to-live in milliseconds (e.g., 60 seconds)
        limit: 10, // Max requests per TTL period
      },
    ]),
    WsModule,
    // ChromaDbModule.forRoot(),
    SessionsModule,
    MessagesModule,
    // QueueModule,
    // KnowledgeModule,
    SseModule,
    ScheduleModule.forRoot(),
    SlackModule,
    CallsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD, // Apply ThrottlerGuard globally
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthHeaderMiddleware)
      .exclude(
        { path: '/', method: RequestMethod.ALL },
        { path: '/health', method: RequestMethod.ALL },
        { path: '/docs', method: RequestMethod.ALL },
        { path: '/docs/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
