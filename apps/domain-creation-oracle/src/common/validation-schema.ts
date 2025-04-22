import { z } from 'zod';

export const didSchema = z.string().regex(/^did:(ixo|x):.*$/);
export const matrixAccessTokenSchema = z.string().regex(/^syt_[a-zA-Z0-9_-]+$/);
