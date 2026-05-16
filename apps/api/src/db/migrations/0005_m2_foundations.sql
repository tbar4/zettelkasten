CREATE TABLE IF NOT EXISTS "custom_link_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_link_type_name_unique" UNIQUE("name"),
	CONSTRAINT "custom_link_type_name_not_empty" CHECK (length("name") > 0)
);
--> statement-breakpoint
ALTER TABLE "note_link" ADD COLUMN IF NOT EXISTS "custom_link_type_id" uuid REFERENCES "custom_link_type"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_link_custom_type_idx" ON "note_link" ("custom_link_type_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_note_id" uuid NOT NULL,
	"scene_data" text,
	"viewport" text,
	"theme" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_topic_note_id_unique" UNIQUE("topic_note_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas" ADD CONSTRAINT "canvas_topic_note_id_note_id_fk" FOREIGN KEY ("topic_note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL DEFAULT 200,
	"height" integer NOT NULL DEFAULT 120,
	"color" text,
	"z_index" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_item" ADD CONSTRAINT "canvas_item_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_item" ADD CONSTRAINT "canvas_item_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_item_canvas_idx" ON "canvas_item" ("canvas_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_item_note_idx" ON "canvas_item" ("note_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"from_item_id" uuid NOT NULL,
	"to_item_id" uuid NOT NULL,
	"label" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_edge_not_self" CHECK ("from_item_id" <> "to_item_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_edge" ADD CONSTRAINT "canvas_edge_canvas_id_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_edge" ADD CONSTRAINT "canvas_edge_from_item_id_canvas_item_id_fk" FOREIGN KEY ("from_item_id") REFERENCES "public"."canvas_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvas_edge" ADD CONSTRAINT "canvas_edge_to_item_id_canvas_item_id_fk" FOREIGN KEY ("to_item_id") REFERENCES "public"."canvas_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_edge_canvas_idx" ON "canvas_edge" ("canvas_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manuscript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"anchor_topic_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
	"body_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manuscript_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manuscript_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"note_id" uuid,
	"is_transclusion" boolean NOT NULL DEFAULT true,
	"frozen_body_md" text,
	"heading" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "manuscript_section" ADD CONSTRAINT "manuscript_section_manuscript_id_manuscript_id_fk" FOREIGN KEY ("manuscript_id") REFERENCES "public"."manuscript"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "manuscript_section" ADD CONSTRAINT "manuscript_section_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manuscript_section_manuscript_idx" ON "manuscript_section" ("manuscript_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manuscript_section_position_idx" ON "manuscript_section" ("manuscript_id", "position");
