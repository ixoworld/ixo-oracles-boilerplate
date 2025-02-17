export const request = async <T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const error = (await response.json()) as { message: string };
    throw new Error(error.message);
  }
  return response.json() as Promise<T>;
};
