import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChromaModule } from './database/chroma.module';
import { DatabaseModule } from './database/database.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    KnowledgeModule,
    DatabaseModule,
    ChromaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
