import { Module } from '@nestjs/common';
import { ChromaModule } from 'src/database/chroma.module';
import { DatabaseModule } from 'src/database/database.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [DatabaseModule, ChromaModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
