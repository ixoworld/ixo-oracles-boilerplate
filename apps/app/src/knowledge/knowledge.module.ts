import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { CHROMA_CLIENT } from '../chroma/chroma-db.module';
import { KnowledgeBatchService } from './knowledge-batch.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [ConfigModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeBatchService,
    {
      provide: 'PG_CONNECTION',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return new Pool({
          user: configService.get('POSTGRES_USER', 'postgres'),
          host: configService.get('POSTGRES_HOST', 'localhost'),
          database: configService.get('POSTGRES_DB', 'knowledge'),
          password: configService.get('POSTGRES_PASSWORD', 'postgres'),
          port: parseInt(configService.get('POSTGRES_PORT', '5432')),
        });
      },
    },
    {
      provide: 'CHROMA_CONNECTION',
      inject: [CHROMA_CLIENT],
      useFactory: async (chromaClient) => {
        return chromaClient;
      },
    },
  ],
  exports: [KnowledgeService, KnowledgeBatchService],
})
export class KnowledgeModule {}
