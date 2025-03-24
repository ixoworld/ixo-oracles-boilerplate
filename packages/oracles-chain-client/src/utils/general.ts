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

/**
 * Adds a specified number of days to a date object and returns a new date object in UTC format.
 * @param date - The date object to add days to.
 * @param days - The number of days to add.
 * @returns A new date object in UTC format.
 */
export const addDays = (date: Date, days: number): Date => {
  const utcDate = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  ); // Ensure input date is in UTC

  utcDate.setUTCDate(utcDate.getUTCDate() + days); // Add days in UTC

  return utcDate; // Return a UTC Date object
};
