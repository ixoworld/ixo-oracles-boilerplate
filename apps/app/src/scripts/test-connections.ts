import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

import { Pool } from 'pg';

dotenv.config({
  path: path.join(__dirname, '../../.env'),
});

// Load environment variables
const configService = new ConfigService(process.env);
/**
 * Script to test database connections
 * Run with: npx ts-node src/scripts/test-connections.ts
 */

async function testPostgres(): Promise<boolean> {
  Logger.log('Testing PostgreSQL connection...');
  const pool = new Pool({
    user: configService.getOrThrow<string>('POSTGRES_USER', 'postgres'),
    host: configService.getOrThrow<string>('POSTGRES_HOST', 'localhost'),
    database: configService.getOrThrow<string>('POSTGRES_DB', 'knowledge'),
    password: configService.getOrThrow<string>('POSTGRES_PASSWORD', 'postgres'),
    port: configService.getOrThrow<number>('POSTGRES_PORT', 5432),
    ...(configService.getOrThrow<string>('DATABASE_USE_SSL') === 'true' && {
      ssl: { rejectUnauthorized: false },
    }),
  });
  try {
    const result = await pool.query('SELECT NOW()');
    Logger.log('✅ PostgreSQL connection successful!');
    Logger.log(`Current time from PostgreSQL: ${result.rows[0].now}`);
    return true;
  } catch (error) {
    Logger.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  } finally {
    await pool.end();
  }
}

async function testChroma(): Promise<boolean> {
  Logger.log('Testing ChromaDB connection...');
  try {
    const response = await fetch('http://localhost:8000/api/v2/heartbeat');
    if (response.status === 200) {
      Logger.log('✅ ChromaDB connection successful!');
      const data = (await response.json()) as { nanosecond_heartbeat: number };
      Logger.log(`ChromaDB heartbeat: ${data.nanosecond_heartbeat}`);
      return true;
    }
    Logger.error('❌ ChromaDB connection failed:', response.statusText);
    return false;
  } catch (error) {
    Logger.error('❌ ChromaDB connection failed:', error.message);
    return false;
  }
}

async function main() {
  Logger.log('Testing database connections...');

  const postgresResult = await testPostgres();
  const chromaResult = await testChroma();

  if (postgresResult && chromaResult) {
    Logger.log('🎉 All database connections are working!');
    process.exit(0);
  } else {
    Logger.error('⚠️ Some database connections failed.');
    process.exit(1);
  }
}

main().catch((error) => {
  Logger.error('Error testing connections:', error);
  process.exit(1);
});
