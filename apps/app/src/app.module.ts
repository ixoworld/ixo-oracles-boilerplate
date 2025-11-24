import { CacheModule } from '@nestjs/cache-manager';
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
import { CallsModule } from './calls/calls.module';
import { EnvSchema } from './config';
import { MessagesModule } from './messages/messages.module';
import { AuthHeaderMiddleware } from './middleware/auth-header.middleware';
import { SubscriptionMiddleware } from './middleware/subscription.middleware';
import { SessionsModule } from './sessions/sessions.module';
import { SlackModule } from './slack/slack.module';
import { TasksService } from './tasks/tasks.service';
import { normalizeDid } from './utils/header.utils';
import { RedisService } from './utils/redis.service';
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
    CacheModule.register({
      isGlobal: true,
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
    ScheduleModule.forRoot(),
    SlackModule,
    CallsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RedisService,
    TasksService,
    {
      provide: APP_GUARD, // Apply ThrottlerGuard globally
      useClass: ThrottlerGuard,
    },
  ],
  exports: [RedisService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthHeaderMiddleware, SubscriptionMiddleware)
      .exclude(
        { path: '/', method: RequestMethod.ALL },
        { path: '/health', method: RequestMethod.ALL },
        { path: '/docs', method: RequestMethod.ALL },
        { path: '/docs/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
