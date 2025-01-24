export const formatMsg = (msg: string, isOracleAdmin: boolean) => {
  return `${isOracleAdmin ? 'Oracle: ' : 'You: '}${msg}`;
};
