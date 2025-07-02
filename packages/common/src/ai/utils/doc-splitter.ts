import { type Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

import { z } from 'zod';

const splitter = new RecursiveCharacterTextSplitter();

export const docSplitter = (text: string | string[]): Promise<Document[]> => {
  if (!text) throw new Error('No text provided');

  const _text = typeof text === 'string' ? [text] : text;
  arrSchema.parse(_text);

  return splitter.createDocuments(_text);
};

const arrSchema = z
  .array(
    z.string({
      message: 'Invalid text provided',
    }),
    {
      message: 'Invalid text provided in array',
    },
  )
  .nonempty({
    message: 'Text array cannot be empty',
  });
