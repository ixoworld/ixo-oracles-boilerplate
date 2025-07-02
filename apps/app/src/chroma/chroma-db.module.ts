import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ENV } from 'src/types';
import { ChromaClientSingleton } from './chroma-client.singleton';

export const CHROMA_CLIENT = 'CHROMA_CLIENT';

@Global()
@Module({})
export class ChromaDbModule {
  /**
   * Call this once in AppModule to configure and initialize the client.
   */
  static forRoot(): DynamicModule {
    return {
      module: ChromaDbModule,
      providers: [
        {
          provide: CHROMA_CLIENT,
          useFactory: async (configService: ConfigService<ENV>) => {
            const opts = {
              collectionName: configService.getOrThrow<string>(
                'CHROMA_COLLECTION_NAME',
                'knowledge',
              ),
              url: configService.getOrThrow<string>(
                'CHROMA_URL',
                'http://localhost:8000',
              ),
            };
            return ChromaClientSingleton.getInstance(opts);
          },
          inject: [ConfigService],
        },
      ],
      exports: [CHROMA_CLIENT],
    };
  }
}
