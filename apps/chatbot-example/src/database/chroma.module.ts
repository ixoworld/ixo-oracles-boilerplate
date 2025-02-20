import { ChromaDataStore } from '@ixo/data-store';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import envService from 'src/env';

export const CHROMA_STORE = 'CHROMA_STORE';

@Module({
  providers: [
    {
      provide: CHROMA_STORE,
      inject: [ConfigService],
      useFactory: async () => {
        const store = new ChromaDataStore({
          url: envService.get('CHROMA_URL'),
          collectionName: 'knowledge-embeddings',
          embeddingFunction: {
            async generate(texts) {
              try {
                const url = 'http://localhost:1234/v1/embeddings';

                const response = await fetch(url, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'text-embedding-nomic-embed-text-v1.5',
                    input: texts,
                  }),
                });
                if (!response.ok) {
                  console.error(
                    'Failed to generate embeddings:',
                    await response.json(),
                  );
                  throw new Error('Failed to generate embeddings');
                }
                const result = (await response.json()) as {
                  data: {
                    embedding: number[];
                  }[];
                };
                return result.data.map((item) => item.embedding);
              } catch (error) {
                console.error('Failed to generate embeddings:', error);
                throw error;
              }
            },
          },
        });
        await store.init();
        console.log('Chroma store initialized');
        return store;
      },
    },
  ],
  exports: [CHROMA_STORE],
})
export class ChromaModule {}
