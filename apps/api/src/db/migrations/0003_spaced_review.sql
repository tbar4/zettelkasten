CREATE TABLE IF NOT EXISTS "spaced_review" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"interval_days" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaced_review" ADD CONSTRAINT "spaced_review_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spaced_review_next_due_idx" ON "spaced_review" USING btree ("next_due_at");