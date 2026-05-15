import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  check
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
    notionPageId: text("notion_page_id")
  },
  (t) => ({
    notionIdIdx: uniqueIndex("note_notion_page_id_idx")
      .on(t.notionPageId)
      .where(sql`${t.notionPageId} IS NOT NULL`),
    typeIdx: index("note_type_idx").on(t.type),
    topicBodyCheck: check(
      "note_topic_body_null",
      sql`(${t.type} <> 'topic') OR (${t.bodyMd} IS NULL)`
    )
  })
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => ({
    uniqEdge: uniqueIndex("note_link_unique").on(
      t.fromNoteId,
      t.toNoteId,
      t.linkType
    ),
    fromIdx: index("note_link_from_idx").on(t.fromNoteId),
    toIdx: index("note_link_to_idx").on(t.toNoteId),
    notSelf: check("note_link_not_self", sql`${t.fromNoteId} <> ${t.toNoteId}`)
  })
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
  (t) => ({
    pk: primaryKey({ columns: [t.noteId, t.tagId] }),
    tagIdx: index("note_tag_tag_idx").on(t.tagId)
  })
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
