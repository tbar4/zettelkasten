CREATE TABLE IF NOT EXISTS "highlight_promotion_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "highlight_id" uuid REFERENCES "highlight"("id") ON DELETE CASCADE,
  "action" text NOT NULL CHECK ("action" IN ('promoted', 'edited', 'rejected')),
  "draft_text" text,
  "final_text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "highlight_promotion_feedback_h_idx" ON "highlight_promotion_feedback"("highlight_id");
