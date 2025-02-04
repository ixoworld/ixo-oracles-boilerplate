import { type Block, type SectionBlock } from '@slack/web-api';
import { type SlackBlock } from '../types';

export const splitLongSlackBlocks = (blocks: SlackBlock[]): SlackBlock[] => {
  const chunkedBlocks: Block[] = [];

  for (const block of blocks) {
    // text blocks are not allowed to be larger than 3000 characters

    const isTextBlock =
      block.type === 'section' && (block as SectionBlock).text;
    const blockTextLength =
      (isTextBlock && (block as SectionBlock).text?.text.length) || 0;
    const shouldChunk = isTextBlock && blockTextLength > 3000;
    if (shouldChunk) {
      const text = (block as SectionBlock).text?.text || '';
      const chunkedText = text.match(/.{1,3000}/g) ?? [text];
      chunkedText.forEach((chunk) => {
        chunkedBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: chunk,
          },
        } as SectionBlock);
      });
    } else {
      chunkedBlocks.push(block);
    }
  }

  return chunkedBlocks;
};
