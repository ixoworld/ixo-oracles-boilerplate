export const isMessageIncludeMention = (
  message: string,
  userId: string,
): boolean => message.includes(`<@${userId}>`);
