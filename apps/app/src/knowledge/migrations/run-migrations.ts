import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import process from 'node:process';
import { migrate } from './migrate';

dotenv.config({
  path: path.join(__dirname, '../../../.env'),
});

/**
 * Script to run knowledge module PostgreSQL migrations
 *
 * Usage:
 * ts-node run-migrations.ts
 */

// Run the migration script
migrate().catch((err) => {
  Logger.error('Fatal migration error:', err);
  process.exit(1);
});
