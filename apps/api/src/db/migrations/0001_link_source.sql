CREATE TYPE "public"."link_source" AS ENUM('wikilink', 'manual');--> statement-breakpoint
ALTER TABLE "note_link" ADD COLUMN "source" "link_source" DEFAULT 'manual' NOT NULL;