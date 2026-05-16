CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS "embedding" (
  "note_id" uuid PRIMARY KEY REFERENCES "note"("id") ON DELETE CASCADE,
  "vector" vector(768) NOT NULL,
  "model_version" text NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "embedding_vector_idx" ON "embedding" USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
