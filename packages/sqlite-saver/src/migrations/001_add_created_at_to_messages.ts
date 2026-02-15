import { type Database as DatabaseType } from 'better-sqlite3';

/**
 * Migration 001: Add created_at column to messages table
 *
 * This migration adds the created_at column to the messages table
 * if it doesn't already exist. It also creates the index that depends on it.
 */
export default {
  version: 1,
  name: 'add_created_at_to_messages',
  up: (db: DatabaseType) => {
    // Check if column exists using PRAGMA
    const columns = db
      .prepare(`SELECT name FROM pragma_table_info('messages') WHERE name = ?`)
      .all('created_at') as Array<{ name: string }>;

    if (columns.length === 0) {
      // Column doesn't exist, add it
      db.exec(`
        ALTER TABLE messages 
        ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
      `);

      // Update any existing rows that might have NULL (safety measure)
      db.exec(`
        UPDATE messages 
        SET created_at = CURRENT_TIMESTAMP 
        WHERE created_at IS NULL;
      `);
    }

    // Create index if it doesn't exist
    const indexExists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_messages_thread_created'`,
      )
      .get() as { name: string } | undefined;

    if (!indexExists) {
      db.exec(`
        CREATE INDEX idx_messages_thread_created 
        ON messages(thread_id, created_at);
      `);
    }
  },
};
