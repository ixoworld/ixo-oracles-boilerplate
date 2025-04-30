-- UP MIGRATION
-- Create status enum type
CREATE TYPE knowledge_status AS ENUM (
  'inserted',        -- row just inserted
  'in_queue',        -- in queue for embedding
  'ai_embedded',     -- embedding done,
  'processing',      -- processing
  'pending_review',  -- waiting for review
  'approved'         -- review passed
);

-- Create knowledge table
CREATE TABLE IF NOT EXISTS knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  links VARCHAR(1024),                    -- Links related to the knowledge item
  questions VARCHAR(1024),                -- Questions associated with the knowledge item
  number_of_chunks INTEGER NOT NULL DEFAULT 0,
  batch_id VARCHAR(255) DEFAULT NULL,     -- Optional batch identifier for batch insert and openAI processing
  status knowledge_status NOT NULL DEFAULT 'inserted',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on title for faster searches
CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge(title);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge(status);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Create trigger to automatically update updated_at column
DROP TRIGGER IF EXISTS update_knowledge_modtime ON knowledge;
CREATE TRIGGER update_knowledge_modtime
BEFORE UPDATE ON knowledge
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- DOWN MIGRATION
-- Uncomment to rollback changes:
/*
DROP TRIGGER IF EXISTS update_knowledge_modtime ON knowledge;
DROP FUNCTION IF EXISTS update_modified_column();
DROP INDEX IF EXISTS idx_knowledge_status;
DROP INDEX IF EXISTS idx_knowledge_title;
DROP TABLE IF EXISTS knowledge;
DROP TYPE IF EXISTS knowledge_status;
*/ 