import { z } from 'zod';

export const oracleConfig = {
  appName: '',
  appPurpose: 'e-commerce store for selling products and services.',
  appMainFeatures:
    'The e-commerce store provides a range of features for selling products and services.',
  appTargetUsers: 'The e-commerce store is targeted at customers.',
  appUniqueSellingPoints:
    'The e-commerce store is a platform for selling products and services.',
};

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  ORACLE_NAME: z.string(),

  // PostgreSQL
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_DB: z.string().default('knowledge'),
  POSTGRES_PASSWORD: z.string().default('postgres'),
  POSTGRES_PORT: z.string().default('5432'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),

  // Langfuse
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().optional(),

  // Chroma
  CHROMA_COLLECTION_NAME: z.string().default('knowledge'),
  CHROMA_URL: z.string().default('http://localhost:8000'),

  // Slack
  SLACK_BOT_OAUTH_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_USE_SOCKET_MODE: z.string().default('true'),
  SLACK_MAX_RECONNECT_ATTEMPTS: z.coerce.number().default(10),
  SLACK_RECONNECT_DELAY_MS: z.coerce.number().default(1000),

  // Matrix
  MATRIX_BASE_URL: z.string(),
  MATRIX_RECOVERY_PHRASE: z.string(),
  MATRIX_CRYPTO_STORE_PATH: z.string().default('./matrix-crypto-store-new'),
  MATRIX_STORE_PATH: z.string().default('./matrix-store-new'),
  MATRIX_ORACLE_ADMIN_ACCESS_TOKEN: z.string(),
  MATRIX_ORACLE_ADMIN_USER_ID: z.string(),
  MATRIX_ORACLE_ADMIN_PASSWORD: z.string(),
  MATRIX_SECRET_STORAGE_KEYS_PATH: z
    .string()
    .default('./matrix-secret-storage-keys-new2'),
  SKIP_LOGGING_CHAT_HISTORY_TO_MATRIX: z.string().optional(),

  // OpenAI - used by @ixo/common package
  OPENAI_API_KEY: z.string().optional(),

  SUBSCRIPTION_ORACLE_MCP_URL: z.string().url().optional(),
  DATABASE_USE_SSL: z.string().default('false'),
});

export type ENV = z.infer<typeof EnvSchema> & {
  ORACLE_DID: string;
};
