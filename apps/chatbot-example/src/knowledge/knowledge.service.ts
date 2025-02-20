import { docSplitter } from '@ixo/common';
import { ChromaDataStore } from '@ixo/data-store';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { CHROMA_STORE } from 'src/database/chroma.module';
import { DATABASE_CONNECTION } from 'src/database/data-base-connection';
import { CreateKnowledgeDto } from './dto/create-knowledge.dto';
import { UpdateKnowledgeDto } from './dto/update-knowledge.dto';
import { knowledge } from './schema/knowledge.schema';

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: NodePgDatabase<{ knowledge: typeof knowledge }>,
    @Inject(CHROMA_STORE)
    private readonly chroma: ChromaDataStore,
  ) {}

  async create(createKnowledgeDto: CreateKnowledgeDto) {
    const id = randomUUID();
    const chunks = await docSplitter(createKnowledgeDto.content);
    const docs = chunks.map((chunk, idx) => ({
      id: `${id}-${idx}`,
      content: chunk.pageContent,
      metadata: {
        approved: createKnowledgeDto.approved ?? false,
        public: createKnowledgeDto.public ?? false,
        category: createKnowledgeDto.category ?? '',
        parentId: id,
      },
    }));

    try {
      await this.chroma.upsert(docs);

      await this.db.insert(knowledge).values({
        id,
        embeddingsId: id,
        content: createKnowledgeDto.content,
        approved: createKnowledgeDto.approved ?? false,
        public: createKnowledgeDto.public ?? false,
        category: createKnowledgeDto.category ?? '',
        noOfChunks: docs.length,
      });

      return id;
    } catch (error) {
      // If any operation fails, ensure we clean up Chroma
      await this.chroma.delete([id]).catch(() => {}); // Ignore cleanup errors
      throw error;
    }
  }

  async findAll(page = 1, limit = 10) {
    try {
      const offset = (page - 1) * limit;
      const data = await this.db.query.knowledge.findMany({
        limit,
        offset,
        orderBy: (knowledge) => knowledge.createdAt,
      });

      return data;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to fetch knowledge', {
        cause: error,
      });
    }
  }

  findOne(id: string) {
    return this.db.query.knowledge.findFirst({
      where: (knowledge, { eq }) => eq(knowledge.id, id),
    });
  }

  async update(id: string, updateKnowledgeDto: UpdateKnowledgeDto) {
    if (updateKnowledgeDto.content) {
      await this.remove(id);
      await this.create({
        content: updateKnowledgeDto.content,
        approved: updateKnowledgeDto.approved ?? false,
        public: updateKnowledgeDto.public ?? false,
        category: updateKnowledgeDto.category ?? '',
      });
    }

    const record = await this.findOne(id);
    if (!record) {
      throw new NotFoundException('Record not found');
    }

    const { noOfChunks, approved, category, public: isPublic } = record;

    const ids = Array.from({ length: noOfChunks }, (_, idx) => `${id}-${idx}`);
    const [, updatedDb] = await Promise.all([
      this.chroma.updateMetadata(
        ids,
        Array.from({ length: noOfChunks }, () => ({
          approved: updateKnowledgeDto.approved ?? approved ?? false,
          public: updateKnowledgeDto.public ?? isPublic ?? false,
          category: updateKnowledgeDto.category ?? category ?? '',
        })),
      ),
      this.db
        .update(knowledge)
        .set({
          approved: updateKnowledgeDto.approved ?? approved ?? false,
          public: updateKnowledgeDto.public ?? isPublic ?? false,
          category: updateKnowledgeDto.category ?? category ?? '',
        })
        .where(eq(knowledge.id, id))
        .returning(),
    ]);

    return updatedDb;
  }

  async remove(id: string) {
    // delete all chunks from chroma
    const record = await this.findOne(id);
    if (!record) {
      throw new Error('Record not found');
    }

    const noOfChunks = record.noOfChunks;
    const ids = Array.from({ length: noOfChunks }, (_, idx) => `${id}-${idx}`);

    await Promise.all([
      this.chroma.delete(ids),
      this.db.delete(knowledge).where(eq(knowledge.id, id)),
    ]);
  }
}
