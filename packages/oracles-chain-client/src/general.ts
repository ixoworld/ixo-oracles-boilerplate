export const chunkArray = <T>(arr: T[], size: number): T[][] =>
  [...Array(Math.ceil(arr.length / size))].map((_, i) =>
    arr.slice(size * i, size + size * i),
  );

export const timeout = async (timeoutMS = 1000): Promise<string> => {
  const result = await new Promise<string>((res) => {
    setTimeout(() => {
      res('Waaa');
    }, timeoutMS);
  });
  return result;
};

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};
