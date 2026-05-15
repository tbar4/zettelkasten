import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  check,
  customType,
  integer
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

export const noteTypeEnum = pgEnum("note_type", [
  "fleeting",
  "literature",
  "permanent",
  "topic"
]);

export const linkTypeEnum = pgEnum("link_type", [
  "references",
  "elaborates",
  "supports",
  "contradicts",
  "example_of",
  "defines",
  "questions",
  "derived_from"
]);

export const linkSourceEnum = pgEnum("link_source", ["wikilink", "manual"]);

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  }
});

export const notes = pgTable(
  "note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: noteTypeEnum("type").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    notionPageId: text("notion_page_id"),
    tsv: tsvector("tsv")
  },
  (t) => [
    uniqueIndex("note_notion_page_id_idx")
      .on(t.notionPageId)
      .where(sql`${t.notionPageId} IS NOT NULL`),
    index("note_type_idx").on(t.type),
    index("note_tsv_idx").using("gin", t.tsv),
    check(
      "note_topic_body_null",
      sql`(${t.type} <> 'topic') OR (${t.bodyMd} IS NULL)`
    )
  ]
);

export const noteLinks = pgTable(
  "note_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromNoteId: uuid("from_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    toNoteId: uuid("to_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    linkType: linkTypeEnum("link_type").notNull().default("references"),
    context: text("context"),
    source: linkSourceEnum("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    uniqueIndex("note_link_unique").on(t.fromNoteId, t.toNoteId, t.linkType),
    index("note_link_from_idx").on(t.fromNoteId),
    index("note_link_to_idx").on(t.toNoteId),
    check("note_link_not_self", sql`${t.fromNoteId} <> ${t.toNoteId}`)
  ]
);

export const tags = pgTable("tag", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const noteTags = pgTable(
  "note_tag",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" })
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.tagId] }),
    index("note_tag_tag_idx").on(t.tagId)
  ]
);

export const spacedReview = pgTable(
  "spaced_review",
  {
    noteId: uuid("note_id")
      .primaryKey()
      .references(() => notes.id, { onDelete: "cascade" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
    intervalDays: integer("interval_days").notNull().default(1)
  },
  (t) => [index("spaced_review_next_due_idx").on(t.nextDueAt)]
);

export const notesRelations = relations(notes, ({ many }) => ({
  outgoingLinks: many(noteLinks, { relationName: "outgoing" }),
  incomingLinks: many(noteLinks, { relationName: "incoming" }),
  noteTags: many(noteTags)
}));

export const noteLinksRelations = relations(noteLinks, ({ one }) => ({
  from: one(notes, {
    fields: [noteLinks.fromNoteId],
    references: [notes.id],
    relationName: "outgoing"
  }),
  to: one(notes, {
    fields: [noteLinks.toNoteId],
    references: [notes.id],
    relationName: "incoming"
  })
}));

export const noteTagsRelations = relations(noteTags, ({ one }) => ({
  note: one(notes, { fields: [noteTags.noteId], references: [notes.id] }),
  tag: one(tags, { fields: [noteTags.tagId], references: [tags.id] })
}));

export const sources = pgTable(
  "source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    author: text("author"),
    sourceType: text("source_type"),
    url: text("url"),
    isbn: text("isbn"),
    readwiseBookId: text("readwise_book_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    uniqueIndex("source_readwise_id_idx")
      .on(t.readwiseBookId)
      .where(sql`${t.readwiseBookId} IS NOT NULL`)
  ]
);

export const highlights = pgTable(
  "highlight",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    noteText: text("note_text"),
    location: text("location"),
    color: text("color"),
    readwiseHighlightId: text("readwise_highlight_id"),
    promotedToNoteId: uuid("promoted_to_note_id").references(() => notes.id, {
      onDelete: "set null"
    }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    uniqueIndex("highlight_readwise_id_idx")
      .on(t.readwiseHighlightId)
      .where(sql`${t.readwiseHighlightId} IS NOT NULL`),
    index("highlight_source_idx").on(t.sourceId),
    index("highlight_unprocessed_idx")
      .on(t.sourceId)
      .where(sql`${t.promotedToNoteId} IS NULL AND ${t.dismissedAt} IS NULL`)
  ]
);

export const noteSources = pgTable(
  "note_source",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" })
  },
  (t) => [primaryKey({ columns: [t.noteId, t.sourceId] })]
);
