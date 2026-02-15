import { ChromaDataStore } from '@ixo/data-store';
import { Logger } from '@nestjs/common';

export interface IChromaOptions {
  collectionName: string;
  url: string;
}

export class ChromaClientSingleton {
  private static instance: ChromaDataStore;

  private constructor() {
    // do nothing
  }

  /**
   * Returns the shared ChromaDataStore, initializing it on first call.
   */
  public static async getInstance(
    opts: IChromaOptions,
  ): Promise<ChromaDataStore> {
    if (!ChromaClientSingleton.instance) {
      const store = new ChromaDataStore({
        collectionName: opts.collectionName,
        url: opts.url,
      });
      await store.init();
      Logger.log(
        `Chroma client initialized for collection ${opts.collectionName}`,
      );
      ChromaClientSingleton.instance = store;
    }
    return ChromaClientSingleton.instance;
  }
}
