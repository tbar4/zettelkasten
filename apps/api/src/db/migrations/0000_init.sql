CREATE TYPE "public"."link_type" AS ENUM('references', 'elaborates', 'supports', 'contradicts', 'example_of', 'defines', 'questions', 'derived_from');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('fleeting', 'literature', 'permanent', 'topic');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "note_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_note_id" uuid NOT NULL,
	"to_note_id" uuid NOT NULL,
	"link_type" "link_type" DEFAULT 'references' NOT NULL,
	"context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_link_not_self" CHECK ("note_link"."from_note_id" <> "note_link"."to_note_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "note_tag" (
	"note_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "note_tag_note_id_tag_id_pk" PRIMARY KEY("note_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "note_type" NOT NULL,
	"title" text NOT NULL,
	"body_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"notion_page_id" text,
	CONSTRAINT "note_topic_body_null" CHECK (("note"."type" <> 'topic') OR ("note"."body_md" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_name_unique" UNIQUE("name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "note_link" ADD CONSTRAINT "note_link_from_note_id_note_id_fk" FOREIGN KEY ("from_note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "note_link" ADD CONSTRAINT "note_link_to_note_id_note_id_fk" FOREIGN KEY ("to_note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "note_tag" ADD CONSTRAINT "note_tag_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "note_tag" ADD CONSTRAINT "note_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "note_link_unique" ON "note_link" USING btree ("from_note_id","to_note_id","link_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_link_from_idx" ON "note_link" USING btree ("from_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_link_to_idx" ON "note_link" USING btree ("to_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_tag_tag_idx" ON "note_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "note_notion_page_id_idx" ON "note" USING btree ("notion_page_id") WHERE "note"."notion_page_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_type_idx" ON "note" USING btree ("type");