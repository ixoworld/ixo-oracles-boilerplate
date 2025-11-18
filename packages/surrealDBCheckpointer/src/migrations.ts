/**
 * To add a new migration, add a new string to the list returned by the getMigrations function.
 * The position of the migration in the list is the version number.
 *
 * Note: SurrealDB uses DEFINE statements instead of CREATE TABLE.
 */
export const getMigrations = () => {
  return [
    // Migration 0: Create checkpoint_migrations table
    `
      DEFINE TABLE checkpoint_migrations SCHEMAFULL;
      DEFINE FIELD v ON TABLE checkpoint_migrations TYPE int ASSERT $value != NONE;
      DEFINE INDEX idx_migrations_v ON TABLE checkpoint_migrations FIELDS v UNIQUE;
    `,

    // Migration 1: Create checkpoints table
    `
      DEFINE TABLE checkpoints SCHEMAFULL;
      DEFINE FIELD thread_id ON TABLE checkpoints TYPE string ASSERT $value != NONE;
      DEFINE FIELD checkpoint_ns ON TABLE checkpoints TYPE string DEFAULT '';
      DEFINE FIELD checkpoint_id ON TABLE checkpoints TYPE string ASSERT $value != NONE;
      DEFINE FIELD parent_checkpoint_id ON TABLE checkpoints TYPE option<string>;
      DEFINE FIELD type ON TABLE checkpoints TYPE option<string>;
      DEFINE FIELD checkpoint ON TABLE checkpoints FLEXIBLE TYPE object ASSERT $value != NONE;
      DEFINE FIELD metadata ON TABLE checkpoints FLEXIBLE TYPE object DEFAULT {};
      DEFINE INDEX idx_checkpoints_pk ON TABLE checkpoints FIELDS thread_id, checkpoint_ns, checkpoint_id UNIQUE;
    `,

    // Migration 2: Create checkpoint_blobs table with record linking
    `
      DEFINE TABLE checkpoint_blobs SCHEMAFULL;
      DEFINE FIELD checkpoint ON TABLE checkpoint_blobs TYPE record<checkpoints>;
      DEFINE FIELD channel ON TABLE checkpoint_blobs TYPE string ASSERT $value != NONE;
      DEFINE FIELD version ON TABLE checkpoint_blobs TYPE string ASSERT $value != NONE;
      DEFINE FIELD type ON TABLE checkpoint_blobs TYPE string ASSERT $value != NONE;
      DEFINE FIELD blob ON TABLE checkpoint_blobs TYPE option<bytes>;
      DEFINE INDEX idx_blobs_unique ON TABLE checkpoint_blobs FIELDS checkpoint, channel, version UNIQUE;
    `,

    // Migration 3: Create checkpoint_writes table with record linking
    `
      DEFINE TABLE checkpoint_writes SCHEMAFULL;
      DEFINE FIELD checkpoint ON TABLE checkpoint_writes TYPE record<checkpoints>;
      DEFINE FIELD task_id ON TABLE checkpoint_writes TYPE string ASSERT $value != NONE;
      DEFINE FIELD idx ON TABLE checkpoint_writes TYPE int ASSERT $value != NONE;
      DEFINE FIELD channel ON TABLE checkpoint_writes TYPE string ASSERT $value != NONE;
      DEFINE FIELD type ON TABLE checkpoint_writes TYPE option<string>;
      DEFINE FIELD blob ON TABLE checkpoint_writes TYPE bytes ASSERT $value != NONE;
      DEFINE INDEX idx_writes_unique ON TABLE checkpoint_writes FIELDS checkpoint, task_id, idx UNIQUE;
    `,
  ];
};
