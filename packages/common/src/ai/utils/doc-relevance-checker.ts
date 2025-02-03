import { type Document } from '@langchain/core/documents';
import { type BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import z from 'zod';
import { getChatOpenAiModel } from '../models/openai';

type TCheckDocRelevanceArgs = {
  doc: Document | string;
  query: string;
  model?: BaseChatModel;
};

async function checkDocRelevance({
  doc,
  model = getChatOpenAiModel(),
  query,
}: TCheckDocRelevanceArgs): Promise<boolean> {
  const prompt = ChatPromptTemplate.fromTemplate(
    `You are an AI agent responsible for determining the relevance of a document to a given query. 
    
		DOCUMENT: ${typeof doc === 'string' ? doc : doc.pageContent} 
		QUERY: ${query} 
    
		### Acceptance Criteria
		(1) Your goal is to identify DOCUMENTs that are completely unrelated to the QUERY.
		(2) If the DOCUMENT contain any keywords or semantic meaning related to the QUERY, consider them relevant.
		(3) It is acceptable if the DOCUMENT have some information that is unrelated to the QUERY, as long as (2) is met.
    
		### Instructions
		(1) Review the DOCUMENT and determine if it is relevant to the QUERY.
		(2) Provide a boolean answer indicating the relevance of the DOCUMENT to the QUERY.
		(3) If the DOCUMENT is relevant, set the answer to true. Otherwise, set the answer to false.
		`,
  );

  const zodSchema = z.object({
    answer: z.boolean(),
  });

  const structuredLlm = model.withStructuredOutput(zodSchema);

  const chain = prompt.pipe(structuredLlm);
  const response = await chain.invoke({
    query,
  });

  return response.answer;
}

export default checkDocRelevance;
