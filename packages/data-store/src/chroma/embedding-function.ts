import { type IEmbeddingFunction } from 'chromadb';
import OpenAI from 'openai';

interface IOpenAIEmbeddingFunctionOptions {
  openai_api_key: string;
  openai_model: string;
  openai_organization_id?: string;
}

export class OpenAIEmbeddingFunction implements IEmbeddingFunction {
  private readonly openai: OpenAI;
  constructor(private readonly options: IOpenAIEmbeddingFunctionOptions) {
    this.openai = new OpenAI({
      apiKey: options.openai_api_key,
      organization: options.openai_organization_id,
    });
  }

  async generate(texts: string[]): Promise<number[][]> {
    const embeddings = await this.openai.embeddings.create({
      model: this.options.openai_model,
      input: texts,
    });
    return embeddings.data.map((embedding) => embedding.embedding);
  }
}
