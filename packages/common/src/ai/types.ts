export type EnsureKeys<
  T extends Record<string, unknown>,
  K extends (keyof T)[],
> = {
  [P in K[number]]: T[P]; // At least one key 'K' from 'T'
} & Partial<T>; // Other keys of 'T' are optional
