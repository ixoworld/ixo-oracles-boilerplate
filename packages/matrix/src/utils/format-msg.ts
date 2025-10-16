import * as marked from 'marked';

interface FormatMsgParams {
  message: string;
  isOracleAdmin: boolean;
  oracleName?: string;
  disablePrefix?: boolean;
}
interface FormatMsgResult {
  content: string;
  htmlContent: string;
}
export const formatMsg = ({
  message,
  isOracleAdmin,
  oracleName = 'Oracle',
  disablePrefix = false,
}: FormatMsgParams): FormatMsgResult => {
  // https://marked.js.org/using_pro#async
  // https://github.com/markedjs/marked/discussions/3219
  // An extension can set marked in async mode so it returns a promise. docs
  // If you don't use extensions, or know none of them are async, it is safe to cast to string.

  const content = disablePrefix
    ? message
    : `**${isOracleAdmin ? oracleName : 'You'}:**\n${message}`;
  const htmlContent = marked.parse(content, {
    gfm: true,
  }) as string;
  return {
    content,
    htmlContent,
  };
};
