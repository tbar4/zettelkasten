ALTER TABLE "note"
  ADD COLUMN "tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("body_md", '')), 'B')
  ) STORED;
--> statement-breakpoint
CREATE INDEX "note_tsv_idx" ON "note" USING gin ("tsv");
