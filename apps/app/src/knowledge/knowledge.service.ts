import {
  docSplitter,
  generateQuestionsFromChunks,
  getOpenAiClient,
} from '@ixo/common';
import { ChromaDataStore, type IVectorStoreDocument } from '@ixo/data-store';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import {
  KnowledgeStatusEnum,
  type CreateKnowledgeDto,
} from './dto/create-knowledge.dto';

import { type Document } from '@langchain/core/documents';
import * as crypto from 'node:crypto';
import { type SemanticSearchDto } from './dto/semantic-search.dto';
import { type UpdateKnowledgeDto } from './dto/update-knowledge.dto';
import { type IKnowledge } from './entities/knowledge.entity';

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject('PG_CONNECTION') private pgPool: Pool,
    @Inject('CHROMA_CONNECTION') private chromaStore: ChromaDataStore,
  ) {}

  async createKnowledge(
    createKnowledgeDto: CreateKnowledgeDto,
  ): Promise<{ id: string; numberOfChunks: number }> {
    const { title, content, links, questions } = createKnowledgeDto;

    // check if content exits

    const contentExists = await this.chromaStore.queryWithSimilarity(content, {
      topK: 1,
      similarityThreshold: 0.9,
    });

    if (contentExists.length > 0) {
      throw new ConflictException({
        message: 'Content already exists',
        statusCode: HttpStatus.CONFLICT,
        content: {
          id: contentExists[0].id.split('/')[0],
        },
      });
    }

    // transform content into chunks
    const id = crypto.randomUUID();

    const chunks = (await docSplitter(content)).map((chunk, index) => ({
      ...chunk,
      id: `${id}/${index + 1}`,
    }));

    // DB transaction
    const client = await this.pgPool.connect();
    await client.query('BEGIN');

    try {
      // Execute DB insert and Chroma upsert in parallel
      const openAI = getOpenAiClient();
      const [{ data: embeddings }, generatedQuestions] = await Promise.all([
        openAI.embeddings.create({
          model: 'text-embedding-3-small',
          input: chunks.map((chunk) => chunk.pageContent),
        }),
        generateQuestionsFromChunks(
          questions
            ? `${content}\n\n AND these are questions i created please take them into account when generating questions: ${questions}`
            : content,
          chunks,
        ),
      ]);
      // insert into DB
      await client.query(
        'INSERT INTO knowledge (id, title, content, links, questions, status, number_of_chunks) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [
          id,
          title,
          content,
          links,
          generatedQuestions
            .map((question) => question.qas.map((q) => q.question))
            .join(','),
          KnowledgeStatusEnum.PENDING_REVIEW,
          chunks.length,
        ],
      );
      const embedding = embeddings.at(0)?.embedding;
      if (!embedding) {
        throw new Error('Embedding not found');
      }
      // upsert into chroma
      await this.chromaStore.addDocumentsWithEmbeddings(
        chunks.map((chunk) => {
          const faqs = generatedQuestions.find(
            (question) => question.chunkId === chunk.id,
          )?.qas;

          return {
            id: chunk.id,
            content: `${chunk.pageContent}\n ####FAQs\n${faqs
              ?.map((q) => `- ${q.question}\n${q.answer}\n`)
              .join('\n')}`,
            embedding,
            metadata: {
              title,
              links: links || '',
              questions: faqs?.map((q) => q.question).join(',') || '',
              status: KnowledgeStatusEnum.PENDING_REVIEW,
            },
          };
        }),
      );
      await client.query('COMMIT');

      return { id, numberOfChunks: chunks.length };
    } catch (error) {
      await Promise.all([
        client.query('ROLLBACK'),
        this.chromaStore.delete(chunks.map((_, idx) => `${id}/${idx + 1}`)),
      ]);
      throw error;
    } finally {
      client.release();
    }
  }

  async getKnowledge(id: string): Promise<IKnowledge> {
    const { rows } = await this.pgPool.query(
      'SELECT * FROM knowledge WHERE id = $1',
      [id],
    );

    if (rows.length === 0) {
      throw new NotFoundException('Knowledge record not found');
    }

    return rows[0] as IKnowledge;
  }

  async getKnowledgeByStatus(
    status: KnowledgeStatusEnum,
  ): Promise<IKnowledge[]> {
    const { rows } = await this.pgPool.query(
      'SELECT * FROM knowledge WHERE status = $1',
      [status],
    );
    return rows as IKnowledge[];
  }

  async listKnowledge(
    status?: KnowledgeStatusEnum,
    page = 1,
    limit = 10,
  ): Promise<{
    records: IKnowledge[];
    pagination: {
      total: number;
      page: number;
      limit: number;
    };
  }> {
    const query = status
      ? 'SELECT * FROM knowledge WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3'
      : 'SELECT * FROM knowledge ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    const { rows, rowCount } = await this.pgPool.query(
      query,
      status
        ? [status, limit, (page - 1) * limit]
        : [limit, (page - 1) * limit],
    );
    return {
      records: rows as IKnowledge[],
      pagination: {
        total: rowCount ?? 0,
        page,
        limit,
      },
    };
  }

  async updateKnowledge(
    id: string,
    updateKnowledgeDto: UpdateKnowledgeDto,
  ): Promise<IKnowledge> {
    // First, get the existing record to compare
    const { rows: existingRows } = await this.pgPool.query(
      'SELECT * FROM knowledge WHERE id = $1',
      [id],
    );

    if (existingRows.length === 0) {
      throw new NotFoundException('Knowledge record not found');
    }

    const existingRecord = existingRows[0] as IKnowledge;
    let numberOfChunks = existingRecord.number_of_chunks;
    let chunksToUpsert: Document[] | null = null;

    // Check for duplicate content if content is being updated
    if (
      updateKnowledgeDto.content &&
      updateKnowledgeDto.content !== existingRecord.content
    ) {
      const contentExists = await this.chromaStore.queryWithSimilarity(
        updateKnowledgeDto.content,
        {
          topK: 1,
          similarityThreshold: 0.9,
        },
      );

      // Check if the duplicate content belongs to another record
      if (contentExists.length > 0) {
        const existingContentId = contentExists[0].id.split('/')[0];
        if (existingContentId !== id) {
          throw new ConflictException({
            message: 'Content already exists',
            statusCode: HttpStatus.CONFLICT,
            content: {
              id: existingContentId,
            },
          });
        }
      }

      // Process new content for ChromaDB
      const chunks = await docSplitter(updateKnowledgeDto.content);
      numberOfChunks = chunks.length;
      chunksToUpsert = chunks;
    }

    // Build dynamic update query with only defined fields
    const fieldsToUpdate: Record<string, string | number> = {};
    const updates: string[] = [];
    const values: (string | number)[] = [];
    let paramIndex = 1;

    // Only include fields that are defined in the update DTO
    if (updateKnowledgeDto.title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(updateKnowledgeDto.title);
      fieldsToUpdate.title = updateKnowledgeDto.title;
      paramIndex++;
    }

    if (updateKnowledgeDto.content !== undefined) {
      updates.push(`content = $${paramIndex}`);
      values.push(updateKnowledgeDto.content);
      fieldsToUpdate.content = updateKnowledgeDto.content;
      paramIndex++;

      // Force status to pending_review if content changes
      updates.push(`status = $${paramIndex}`);
      values.push(KnowledgeStatusEnum.PENDING_REVIEW);
      fieldsToUpdate.status = KnowledgeStatusEnum.PENDING_REVIEW;
      paramIndex++;

      // Update number_of_chunks
      updates.push(`number_of_chunks = $${paramIndex}`);
      values.push(numberOfChunks);
      fieldsToUpdate.number_of_chunks = numberOfChunks;
      paramIndex++;
    }

    if (updateKnowledgeDto.links !== undefined) {
      updates.push(`links = $${paramIndex}`);
      values.push(updateKnowledgeDto.links);
      fieldsToUpdate.links = updateKnowledgeDto.links;
      paramIndex++;
    }

    if (updateKnowledgeDto.questions !== undefined) {
      updates.push(`questions = $${paramIndex}`);
      values.push(updateKnowledgeDto.questions);
      fieldsToUpdate.questions = updateKnowledgeDto.questions;
      paramIndex++;
    }

    // If nothing to update, return existing record
    if (updates.length === 0) {
      return existingRecord;
    }

    // Add id as the last parameter
    values.push(id);

    // Begin transaction if we need to update both PostgreSQL and ChromaDB
    const client = await this.pgPool.connect();

    try {
      await client.query('BEGIN');

      // Update in PostgreSQL
      const query = `UPDATE knowledge SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`;
      const { rows } = await client.query(query, values);

      // Update in ChromaDB if content has changed
      if (chunksToUpsert) {
        const generatedQuestions = updateKnowledgeDto.content
          ? await generateQuestionsFromChunks(
              updateKnowledgeDto.questions
                ? `${updateKnowledgeDto.content}\n\n AND these are questions i created please take them into account when generating questions: ${updateKnowledgeDto.questions}`
                : updateKnowledgeDto.content,
              chunksToUpsert,
            )
          : [];
        // Delete old chunks
        await this.chromaStore.delete(
          Array.from(
            { length: existingRecord.number_of_chunks },
            (_, i) => `${id}/${i + 1}`,
          ),
        );

        // Insert new chunks
        await this.chromaStore.upsert(
          chunksToUpsert.map((chunk, index) => ({
            id: `${id}/${index + 1}`,
            content: `${chunk.pageContent}\n ####FAQs${
              generatedQuestions
                .find((question) => question.chunkId === chunk.id)
                ?.qas.map((q) => `- ${q.question}\n${q.answer}`)
                .join('\n') || ''
            }`,
            metadata: {
              title: fieldsToUpdate.title || existingRecord.title,
              links: fieldsToUpdate.links || existingRecord.links || '',
              questions:
                fieldsToUpdate.questions ||
                generatedQuestions
                  .find((question) => question.chunkId === chunk.id)
                  ?.qas.map((q) => q.question)
                  .join(',') ||
                existingRecord.questions ||
                '',
            },
          })),
        );
      }
      const ids = Array.from(
        { length: existingRecord.number_of_chunks },
        (_, i) => `${id}/${i + 1}`,
      );
      await this.chromaStore.updateMetadata(
        ids,
        ids.map(() => ({
          status: KnowledgeStatusEnum.PENDING_REVIEW,
          title: fieldsToUpdate.title || existingRecord.title,
          links: fieldsToUpdate.links || existingRecord.links || '',
          questions: fieldsToUpdate.questions || existingRecord.questions || '',
        })),
      );
      await client.query('COMMIT');
      return rows[0] as IKnowledge;
    } catch (error) {
      await client.query('ROLLBACK');
      if (chunksToUpsert) {
        await this.chromaStore.delete(
          chunksToUpsert.map((_, idx) => `${id}/${idx + 1}`),
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateKnowledgeStatus(
    id: string,
    status: KnowledgeStatusEnum,
  ): Promise<{ id: string; status: KnowledgeStatusEnum }> {
    const { rows: existingRows } = await this.pgPool.query<
      Pick<
        IKnowledge,
        'id' | 'number_of_chunks' | 'title' | 'links' | 'questions' | 'status'
      >
    >(
      'SELECT id, number_of_chunks, title, links, questions, status FROM knowledge WHERE id = $1',
      [id],
    );

    if (existingRows.length === 0) {
      throw new NotFoundException('Knowledge record not found');
    }

    const oldStatus = existingRows[0].status;
    if (oldStatus === status) {
      throw new BadRequestException('Status is already set to this value');
    }

    if (
      status !== KnowledgeStatusEnum.PENDING_REVIEW &&
      status !== KnowledgeStatusEnum.APPROVED
    ) {
      throw new BadRequestException(
        'Status can only be PENDING_REVIEW or APPROVED',
      );
    }

    //  transaction
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      await client.query('UPDATE knowledge SET status = $1 WHERE id = $2', [
        status,
        id,
      ]);

      await this.chromaStore.updateMetadata(
        Array.from(
          { length: existingRows[0].number_of_chunks },
          (_, i) => `${id}/${i + 1}`,
        ),
        Array.from({ length: existingRows[0].number_of_chunks }, () => ({
          status,
          // title: existingRows[0].title,
          // links: existingRows[0].links || '',
          // questions: existingRows[0].questions || '',
        })),
      );
      await client.query('COMMIT');
      return { id, status };
    } catch (error) {
      await client.query('ROLLBACK');
      if (existingRows[0].number_of_chunks) {
        await this.chromaStore.delete(
          Array.from(
            { length: existingRows[0].number_of_chunks },
            (_, i) => `${id}/${i + 1}`,
          ),
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteKnowledge(id: string): Promise<void> {
    const { rows: existingRows } = await this.pgPool.query<IKnowledge>(
      'SELECT * FROM knowledge WHERE id = $1',
      [id],
    );

    if (existingRows.length === 0) {
      throw new NotFoundException('Knowledge record not found');
    }

    await this.chromaStore.delete(
      Array.from(
        { length: existingRows[0].number_of_chunks },
        (_, i) => `${id}/${i + 1}`,
      ),
    );

    await this.pgPool.query('DELETE FROM knowledge WHERE id = $1', [id]);
  }

  async semanticSearch(
    searchKnowledgeDto: SemanticSearchDto,
  ): Promise<IVectorStoreDocument[]> {
    const { query } = searchKnowledgeDto;
    const results = await this.chromaStore.queryWithSimilarity(query, {
      topK: 10,
      similarityThreshold: 0.4,
    });

    return results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
}
