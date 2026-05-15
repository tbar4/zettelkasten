CREATE TABLE IF NOT EXISTS "highlight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"text" text NOT NULL,
	"note_text" text,
	"location" text,
	"color" text,
	"readwise_highlight_id" text,
	"promoted_to_note_id" uuid,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "note_source" (
	"note_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "note_source_note_id_source_id_pk" PRIMARY KEY("note_id","source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"source_type" text,
	"url" text,
	"isbn" text,
	"readwise_book_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "highlight" ADD CONSTRAINT "highlight_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "highlight" ADD CONSTRAINT "highlight_promoted_to_note_id_note_id_fk" FOREIGN KEY ("promoted_to_note_id") REFERENCES "public"."note"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "note_source" ADD CONSTRAINT "note_source_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "note_source" ADD CONSTRAINT "note_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "highlight_readwise_id_idx" ON "highlight" USING btree ("readwise_highlight_id") WHERE "highlight"."readwise_highlight_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "highlight_source_idx" ON "highlight" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "highlight_unprocessed_idx" ON "highlight" USING btree ("source_id") WHERE "highlight"."promoted_to_note_id" IS NULL AND "highlight"."dismissed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_readwise_id_idx" ON "source" USING btree ("readwise_book_id") WHERE "source"."readwise_book_id" IS NOT NULL;