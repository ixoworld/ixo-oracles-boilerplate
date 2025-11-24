import { slackifyMarkdown } from 'slackify-markdown';

export const transformMarkdown = (text: string): string => {
  // First replace escaped newlines with actual newlines
  const textWithProperNewlines = text.replace(/\\n/g, '\n');
  return slackifyMarkdown(textWithProperNewlines);
};
