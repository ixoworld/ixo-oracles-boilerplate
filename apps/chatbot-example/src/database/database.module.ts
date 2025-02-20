import { Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import envService from 'src/env';
import { knowledge } from 'src/knowledge/schema/knowledge.schema';
import { DATABASE_CONNECTION } from './data-base-connection';

@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: async () => {
        const dbUrl = envService.get('DATABASE_URL');
        const pool = new Pool({ connectionString: dbUrl });
        // test connection
        try {
          const client = await pool.connect();
          console.log('Database connection successful');
          return drizzle(client, {
            schema: {
              knowledge,
            },
          });
        } catch (error) {
          console.error('Failed to connect to database:', error);
          process.exit(1);
        }
      },
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
