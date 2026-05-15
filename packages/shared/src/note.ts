import { z } from "zod";

export const NoteType = z.enum([
  "fleeting",
  "literature",
  "permanent",
  "topic"
]);
export type NoteType = z.infer<typeof NoteType>;

const NoteBase = z.object({
  title: z.string().min(1),
  type: NoteType,
  body_md: z.string().nullable().optional()
});

export const NewNoteSchema = NoteBase.superRefine((data, ctx) => {
  if (data.type === "topic" && data.body_md !== undefined && data.body_md !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "topic notes must not have body_md",
      path: ["body_md"]
    });
  }
});
export type NewNote = z.infer<typeof NewNoteSchema>;

export const UpdateNoteSchema = NoteBase.partial().superRefine((data, ctx) => {
  if (data.type === "topic" && data.body_md !== undefined && data.body_md !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "topic notes must not have body_md",
      path: ["body_md"]
    });
  }
});
export type UpdateNote = z.infer<typeof UpdateNoteSchema>;

export const NoteSchema = z.object({
  id: z.string().uuid(),
  type: NoteType,
  title: z.string(),
  body_md: z.string().nullable(),
  tags: z.array(z.string()),
  sources: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      author: z.string().nullable(),
      url: z.string().nullable()
    })
  ),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
  notion_page_id: z.string().nullable()
});
export type Note = z.infer<typeof NoteSchema>;
