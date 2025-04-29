import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from 'nestjs-throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChromaDbModule } from './chroma/chroma-db.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MessagesModule } from './messages/messages.module';
import { AuthHeaderMiddleware } from './middleware/auth-header.middleware';
import { SessionsModule } from './sessions/sessions.module';
import { SseModule } from './sse/sse.module';
import { SlackModule } from './slack/slack.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigModule available globally
      envFilePath: '.env', // Specify the .env file path
    }),
    ThrottlerModule.forRoot({
      ttl: 60000, // Time-to-live in milliseconds (e.g., 60 seconds)
      limit: 10, // Max requests per TTL period
    }),
    ChromaDbModule.forRoot(),
    SessionsModule,
    MessagesModule,
    KnowledgeModule,
    SseModule,
    ScheduleModule.forRoot(),
    SlackModule,
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
