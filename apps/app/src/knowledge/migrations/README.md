# Knowledge Module PostgreSQL Migrations

This directory contains SQL migration scripts for the Knowledge module's PostgreSQL database.

## Migration Files

- `001_create_knowledge_table.sql`: Creates the initial knowledge table with necessary indexes and triggers.

## Running Migrations

To run migrations:

1. Ensure PostgreSQL is running and accessible with the configured credentials
2. Set environment variables if needed:
   ```
   POSTGRES_USER=yourusername
   POSTGRES_PASSWORD=yourpassword
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_DB=yourdatabase
   ```
3. Execute the migration runner:
   ```
   cd apps/app/src/knowledge/migrations
   npx ts-node run-migrations.ts
   ```

## Creating New Migrations

When adding new migrations:

1. Create a new SQL file with a sequential prefix (e.g., `002_add_tags_column.sql`)
2. Include both UP and DOWN migrations
3. Migration files will be run in alphabetical order
4. Each migration is tracked in the database and only runs once

## Manual Database Interaction

You can also run migrations manually with PostgreSQL client tools:

```bash
psql -U postgres -d knowledge -f 001_create_knowledge_table.sql
```
