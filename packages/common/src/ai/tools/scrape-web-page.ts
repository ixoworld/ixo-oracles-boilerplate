import { PlaywrightWebBaseLoader } from '@langchain/community/document_loaders/web/playwright';
import { HtmlToTextTransformer } from '@langchain/community/document_transformers/html_to_text';
import { Document } from '@langchain/core/documents';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { PromptTemplate } from '@langchain/core/prompts';
// import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';

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
  _url: string,
  _llm?: BaseChatModel,
) => {
  console.log('scrapeAndSummarizeWebPage', _url, _llm);
  console.log('prompt', prompt);
  // const doc = await scrapeWebPage(url);
  // const _llm =
  //   llm ??
  //   getChatOpenAiModel({
  //     temperature: 0,
  //   });
  // const chain = await createStuffDocumentsChain({
  //   llm: _llm,
  //   outputParser: new StringOutputParser(),
  //   prompt,
  // });

  // const result = await chain.invoke({
  //   context: doc.pageContent,
  // });

  return 'result';
};
