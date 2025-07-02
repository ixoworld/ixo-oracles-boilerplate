import { type Document } from '@langchain/core/documents';

/**
 *
 * @param docs - Array of documents to stringify
 * @returns  - Stringified documents with ID in Header
 */
export const stringifyDocs = (docs: Document[]): string => {
  return docs
    .map(
      (doc) => `#ID:${doc.metadata.id}\n Document: ${doc.pageContent} \n \n `,
    )
    .join('\n\n');
};
