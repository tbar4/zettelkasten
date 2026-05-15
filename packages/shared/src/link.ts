import { z } from "zod";

export const LinkType = z.enum([
  "references",
  "elaborates",
  "supports",
  "contradicts",
  "example_of",
  "defines",
  "questions",
  "derived_from"
]);
export type LinkType = z.infer<typeof LinkType>;

export const NewNoteLinkSchema = z
  .object({
    from_note_id: z.string().uuid(),
    to_note_id: z.string().uuid(),
    link_type: LinkType.default("references"),
    context: z.string().optional()
  })
  .refine((data) => data.from_note_id !== data.to_note_id, {
    message: "from_note_id and to_note_id must differ",
    path: ["to_note_id"]
  });
export type NewNoteLink = z.infer<typeof NewNoteLinkSchema>;

export const NoteLinkSchema = z.object({
  id: z.string().uuid(),
  from_note_id: z.string().uuid(),
  to_note_id: z.string().uuid(),
  link_type: LinkType,
  context: z.string().nullable(),
  created_at: z.string().datetime()
});
export type NoteLink = z.infer<typeof NoteLinkSchema>;
