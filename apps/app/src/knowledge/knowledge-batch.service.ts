import {
  chunkArr,
  docSplitter,
  generateQuestionsFromChunks,
  getOpenAiClient,
} from '@ixo/common';
import { ChromaDataStore } from '@ixo/data-store';
import { type Document } from '@langchain/core/documents';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { type BatchKnowledgeDto } from './dto/batch-knowledge.dto';
import { KnowledgeStatusEnum } from './dto/create-knowledge.dto';
import { type IKnowledge } from './entities/knowledge.entity';
import { KnowledgeService } from './knowledge.service';

@Injectable()
export class KnowledgeBatchService {
  constructor(
    @Inject('PG_CONNECTION') private pgPool: Pool,
    @Inject('CHROMA_CONNECTION') private chromaStore: ChromaDataStore,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async createBatch(batchKnowledgeDto: BatchKnowledgeDto): Promise<void> {
    const ids = await this.insertBatchRecordToDB(batchKnowledgeDto);
    await this.sendBatchToOpenAI(
      batchKnowledgeDto.items.map((item, idx) => ({
        id: ids[idx],
        title: item.title,
        content: item.content,
        links: item.links,
        questions: item.questions,
      })),
    );
  }

  // Run every 10 minutes
  @Cron('*/1 * * * *')
  async processBatch(): Promise<void> {
    Logger.log('Checking for batches to process');
    const batchId = await this.getBatchId();
    if (!batchId) {
      Logger.log('No Batch to process');
      return;
    }
    const batchResults = await this.getBatchResultsFromOpenAI(batchId);
    if (batchResults.length === 0) {
      Logger.log('No Batch Results to process');
      return;
    }
    const batches = chunkArr(batchResults, 10);
    for await (const batch of batches) {
      await this.addEmbeddingsToRecords(batchId, batch);
    }
  }
  private async getBatchId(): Promise<string | null> {
    const client = await this.pgPool.connect();
    const result = await client.query<{ batch_id: string }>(
      'SELECT batch_id FROM knowledge WHERE status = $1 AND batch_id IS NOT NULL LIMIT 1',
      [KnowledgeStatusEnum.IN_QUEUE],
    );
    const batchId = result.rows.at(0)?.batch_id;
    if (!batchId) {
      return null;
    }
    return batchId;
  }
  private async insertBatchRecordToDB(
    batchKnowledgeDto: BatchKnowledgeDto,
  ): Promise<string[]> {
    if (!batchKnowledgeDto.items.length) return [];
    const createKnowledgeDto = batchKnowledgeDto.items;

    Logger.log(
      `Processing batch insertion of ${createKnowledgeDto.length} records`,
      'KnowledgeBatchService',
    );

    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // 1) Define columns
      const columns = ['title', 'content', 'links', 'questions', 'status'];

      // 2) Build placeholders and flatten values
      const valueClauses: string[] = [];
      const values: unknown[] = [];

      // Filter out any potentially invalid records
      const validRecords = createKnowledgeDto.filter((dto) =>
        Boolean(dto.title),
      );

      if (validRecords.length !== createKnowledgeDto.length) {
        Logger.warn(
          `Filtered out ${createKnowledgeDto.length - validRecords.length} records with missing title`,
          'KnowledgeBatchService',
        );
      }

      validRecords.forEach((dto, rowIdx) => {
        const offset = rowIdx * columns.length;
        const placeholders = columns
          .map((_, colIdx) => `$${offset + colIdx + 1}`)
          .join(', ');
        valueClauses.push(`(${placeholders})`);

        values.push(
          dto.title,
          dto.content || '',
          dto.links || '',
          dto.questions || '',
          KnowledgeStatusEnum.INSERTED,
        );
      });

      // Skip if no valid records after filtering
      if (!validRecords.length) {
        Logger.warn(
          'No valid records to insert after filtering',
          'KnowledgeBatchService',
        );
        await client.query('COMMIT');
        return [];
      }

      // 3) Compose the INSERT
      const sql = `
        INSERT INTO knowledge (${columns.join(', ')})
        VALUES ${valueClauses.join(', ')}
        RETURNING id
      `;

      // 4) Run it inside the transaction
      const result = await client.query<{ id: string }>(sql, values);
      Logger.log(
        `Successfully inserted ${validRecords.length} records`,
        'KnowledgeBatchService',
      );

      await client.query('COMMIT');
      return result.rows.map((row) => row.id);
    } catch (err) {
      await client.query('ROLLBACK');
      Logger.error(
        `Failed to insert batch records: ${err instanceof Error ? err.message : String(err)}`,
        'KnowledgeBatchService',
      );
      throw err;
    } finally {
      client.release();
    }
  }

  private async sendBatchToOpenAI(
    recordsToProcess: Pick<
      IKnowledge,
      'id' | 'title' | 'content' | 'links' | 'questions'
    >[],
  ): Promise<void> {
    Logger.log(`Sending ${recordsToProcess.length} records to OpenAI`);
    const chunkedDocs: Document[] = [];

    const recordsIds: string[] = [];

    for await (const record of recordsToProcess) {
      const docs = await docSplitter(record.content);
      chunkedDocs.push(
        ...docs.map((doc, idx) => ({
          ...doc,
          id: `${record.id}/${idx + 1}`,
          metadata: {
            ...doc.metadata,
            id: record.id,
          },
        })),
      );
      recordsIds.push(record.id);
    }

    // jsonl format
    const jsonl = chunkedDocs.map((record) =>
      JSON.stringify({
        custom_id: record.id,
        method: 'POST',
        url: '/v1/embeddings',
        body: {
          model: 'text-embedding-3-small',
          input: record.pageContent,
        },
      }),
    );
    Logger.log(`Created ${jsonl.length} jsonl records`);
    const jsonlString = jsonl.join('\n');

    // 2. Create a Blob and then a File
    const blob = new Blob([jsonlString], { type: 'application/json' });
    const fileToUpload = new File(
      [blob],
      `knowledge_batch_${Date.now()}.jsonl`,
      {
        type: 'application/json',
      },
    );

    // send to openAI
    const openai = getOpenAiClient();

    // upload file to openAI using the stream directly
    const file = await openai.files.create({
      file: fileToUpload,
      purpose: 'batch',
    });
    Logger.log(`Uploaded file to OpenAI ${file.id}`);
    // create a batch
    const batch = await openai.batches.create({
      completion_window: '24h',
      endpoint: '/v1/embeddings',
      input_file_id: file.id,
    });
    Logger.log(`Created batch ${batch.id}`);
    // update the batch id to the records
    await this.pgPool.query(
      'UPDATE knowledge SET batch_id = $1, status = $2 WHERE id = ANY($3)',
      [batch.id, KnowledgeStatusEnum.IN_QUEUE, recordsIds],
    );
  }

  private async getBatchResultsFromOpenAI(batchId: string): Promise<
    {
      chunkId: string;
      embeddings: number[];
    }[]
  > {
    const openai = getOpenAiClient();
    const batch = await openai.batches.retrieve(batchId);

    if (!batch.output_file_id) {
      Logger.log(`Still processing ${batchId}...`);
      return [];
    }

    const fileResponse = await openai.files.content(batch.output_file_id);
    const fileContents = await fileResponse.text();
    const lines = fileContents.split('\n');

    const processedLines: {
      chunkId: string;
      embeddings: number[];
    }[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line) as {
        custom_id: string;
        response: {
          status_code: number;
          body: {
            data: {
              object: 'embedding';
              index: 0;
              embedding: number[];
            }[];
          };
        };
      };
      if (data.response.status_code !== 200) continue;
      const embeddings = data.response.body.data.at(0)?.embedding;

      if (!embeddings) throw new Error('Embeddings not found');
      processedLines.push({
        chunkId: data.custom_id,
        embeddings,
      });
    }
    return processedLines;
  }

  private async addEmbeddingsToRecords(
    batchId: string,
    batchResults: {
      chunkId: string;
      embeddings: number[];
    }[],
  ): Promise<void> {
    const client = await this.pgPool.connect();

    Logger.log(`Adding ${batchResults.length} embeddings to records`);

    // all records ids
    const recordsIds = batchResults.map((r) => r.chunkId.split('/')[0]);

    // set status to processing
    const [, { rows }] = await Promise.all([
      client.query('UPDATE knowledge SET status = $1 WHERE id = ANY($2)', [
        KnowledgeStatusEnum.PROCESSING,
        recordsIds,
      ]),
      client.query('SELECT id, content FROM knowledge WHERE id = ANY($1)', [
        recordsIds,
      ]),
    ]);

    // full content of the records
    const recordsMap = new Map<string, string>(
      rows.map((r) => [r.id, r.content]),
    );

    const records = new Map<
      string,
      {
        chunks: {
          chunkId: string;
          embeddings: number[];
          content: string;
        }[];
      }
    >();

    const chunksCache = new Map<string, Document[]>();

    const getChunks = async (recordId: string) => {
      if (chunksCache.has(recordId)) return chunksCache.get(recordId);
      const knowledgeContent = recordsMap.get(recordId);
      if (!knowledgeContent)
        throw new Error(
          `Knowledge content not found for record id: ${recordId}`,
        );
      const chunks = await docSplitter(knowledgeContent);
      chunksCache.set(
        recordId,
        chunks.map((c, idx) => ({
          ...c,
          id: `${recordId}/${idx + 1}`,
        })),
      );
      return chunksCache.get(recordId);
    };

    for await (const result of batchResults) {
      const [recordId] = result.chunkId.split('/');
      if (!records.has(recordId)) {
        records.set(recordId, { chunks: [] });
      }
      const chunks = await getChunks(recordId);
      const chunk = chunks?.find((c) => c.id === result.chunkId);
      if (!chunk) throw new Error('Chunk not found');
      Logger.debug(
        `Adding chunk ${result.chunkId} to record ${recordId}`,
        'KnowledgeBatchService',
      );
      records.get(recordId)?.chunks.push({
        chunkId: result.chunkId,
        embeddings: result.embeddings,
        content: chunk.pageContent,
      });
    }

    try {
      await client.query('BEGIN');

      for await (const [recordId, { chunks }] of records.entries()) {
        const knowledgeContent = recordsMap.get(recordId);
        if (!knowledgeContent)
          throw new Error(
            `Knowledge content not found for record id: ${recordId}`,
          );

        const generatedQuestions = await generateQuestionsFromChunks(
          knowledgeContent,
          chunks.map((c) => ({
            pageContent: c.content,
            id: c.chunkId,
            metadata: {
              id: c.chunkId,
            },
          })),
        );

        // Update each record individually with its own SQL statement
        const sql = `
          UPDATE knowledge SET status = $1, number_of_chunks = $2, questions = $3 WHERE id = $4
        `;

        await Promise.all([
          client.query(sql, [
            KnowledgeStatusEnum.PENDING_REVIEW,
            chunks.length,
            generatedQuestions
              .map((q) => q.qas.map((qa) => qa.question).join(','))
              .join(','),
            recordId,
          ]),
          this.chromaStore.addDocumentsWithEmbeddings(
            chunks.map((chunk) => {
              const faqs = generatedQuestions.find(
                (question) => question.chunkId === chunk.chunkId,
              )?.qas;
              return {
                id: chunk.chunkId,
                embedding: chunk.embeddings,
                content: `${chunk.content}\n ####FAQs\n${faqs
                  ?.map((q) => `- ${q.question}\n${q.answer}\n`)
                  .join('\n')}`,
                metadata: {
                  id: recordId,
                  questions: faqs?.map((q) => q.question).join(',') || '',
                  status: KnowledgeStatusEnum.PENDING_REVIEW,
                },
              };
            }),
          ),
        ]);

        Logger.log(
          `Updated record ${recordId} with ${chunks.length} chunks and ${generatedQuestions.length} questions`,
        );
      }

      await client.query('COMMIT');
      Logger.log(`Successfully completed batch of ${records.size} records`);
    } catch (err) {
      Logger.error(
        `Failed to add embeddings to records: ${err instanceof Error ? err.message : String(err)}`,
        'KnowledgeBatchService',
      );
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
