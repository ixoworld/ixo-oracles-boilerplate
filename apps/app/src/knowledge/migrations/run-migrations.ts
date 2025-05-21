import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';

const configService = new ConfigService();
/**
 * Script to run knowledge module PostgreSQL migrations
 *
 * Usage:
 * ts-node run-migrations.ts
 */

async function runMigrations() {
  Logger.log('Starting migrations...');

  // Configure PostgreSQL connection from environment variables
  const pool = new Pool({
    user: configService.getOrThrow<string>('POSTGRES_USER', 'postgres'),
    host: configService.getOrThrow<string>('POSTGRES_HOST', 'localhost'),
    database: configService.getOrThrow<string>('POSTGRES_DB', 'knowledge'),
    password: configService.getOrThrow<string>('POSTGRES_PASSWORD', 'postgres'),
    port: configService.getOrThrow<number>('POSTGRES_PORT', 5432),
    ...(configService.getOrThrow<string>('DATABASE_USE_SSL') && {
      ssl: { rejectUnauthorized: false },
    }),
  });

  Logger.log(
    `Connecting to PostgreSQL at ${configService.getOrThrow<string>('POSTGRES_HOST', 'localhost')}:${configService.getOrThrow<number>('POSTGRES_PORT', 5432)}`,
  );

  // Create migrations table if it doesn't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    // Get all SQL migration files
    const migrationsDir = path.join(__dirname);
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // Sort to ensure they run in order

    // Check which migrations have already been applied
    const { rows: appliedMigrations } = await pool.query(
      'SELECT name FROM migrations',
    );
    const appliedMigrationNames = appliedMigrations.map((row) => row.name);

    // Determine which migrations need to be applied
    const pendingMigrations = migrationFiles.filter(
      (file) => !appliedMigrationNames.includes(file),
    );

    if (pendingMigrations.length === 0) {
      Logger.log('No pending migrations to apply.');
      await pool.end();
      return;
    }

    Logger.log(`Applying ${pendingMigrations.length} migrations...`);

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Run each migration
      for (const migrationFile of pendingMigrations) {
        Logger.log(`Applying migration: ${migrationFile}`);

        // Read the migration file
        const migrationPath = path.join(migrationsDir, migrationFile);
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        // Execute the migration
        await client.query(migrationSql);

        // Record that the migration was applied
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [
          migrationFile,
        ]);
      }

      // Commit transaction
      await client.query('COMMIT');
      Logger.log('All migrations applied successfully!');
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      Logger.error('Error applying migrations:', error);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    Logger.error('Migration error:', error);
    await pool.end();
    process.exit(1);
  }
}

// Run the migration script
runMigrations().catch((err) => {
  Logger.error('Fatal migration error:', err);
  process.exit(1);
});
