CREATE TABLE IF NOT EXISTS "suggestion_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "from_note_id" uuid REFERENCES "note"("id") ON DELETE CASCADE,
  "to_note_id" uuid NOT NULL REFERENCES "note"("id") ON DELETE CASCADE,
  "action" text NOT NULL CHECK ("action" IN ('accepted', 'rejected', 'dismissed')),
  "surfaced_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "suggestion_feedback_to_idx" ON "suggestion_feedback"("to_note_id");
