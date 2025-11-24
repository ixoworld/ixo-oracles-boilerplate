import { PlaywrightWebBaseLoader } from '@langchain/community/document_loaders/web/playwright';
import { HtmlToTextTransformer } from '@langchain/community/document_transformers/html_to_text';
import { Document } from '@langchain/core/documents';
import { PromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';

export const scrapeWebPage = async (url: string) => {
  const content = await PlaywrightWebBaseLoader._scrape(url, {
    launchOptions: {
      headless: true,
    },
    gotoOptions: {
      waitUntil: 'domcontentloaded',
    },
  });
  const transformer = new HtmlToTextTransformer({});
  const docs = await transformer.transformDocuments([
    new Document({
      pageContent: content,
      metadata: {
        source: url,
      },
    }),
  ]);
  return new Document({
    pageContent: docs.map((doc) => doc.pageContent).join('\n'),
    metadata: {
      source: url,
    },
  });
};
const prompt = PromptTemplate.fromTemplate(
  `
  You are a helpful assistant that summarizes web pages.

  #Guidelines
  - Add key points at the beginning of the Document.
  - Add the summary based on the key points.

  #Rules
  - Ignore the html tags and only focus on the content.
  - Read the content of the page and summarize.
  - DO NOT HALLUCINATE or make up information.
  - DO NOT ADD ANYTHING ELSE OTHER THAN THE SUMMARY.

  #Document
  {context}
  `,
);

export const scrapeAndSummarizeWebPage = async (
  url: string,
  llm: ChatOpenAI,
) => {
  const doc = await scrapeWebPage(url);

  const agent = createAgent({
    model: llm,
    tools: [],
  });

  const result = await agent.invoke({
    messages: [
      {
        role: 'user',
        content: await prompt.format({
          context: doc.pageContent,
        }),
      },
    ],
  });

  return result;
};
