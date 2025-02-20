import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const knowledge = pgTable(
  'knowledge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    embeddingsId: uuid('embeddings_id').unique(),
    noOfChunks: integer('no_of_chunks').notNull().default(0),
    content: text('content').notNull(),
    category: text('category'),
    approved: boolean('approved').notNull().default(false),
    public: boolean('public').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('embeddings_id_idx').on(t.embeddingsId),
    index('created_at_idx').on(t.createdAt),
  ],
);
