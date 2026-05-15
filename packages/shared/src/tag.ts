import { z } from "zod";

export const NewTagSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: "tag must be lowercase kebab-case"
  })
});
export type NewTag = z.infer<typeof NewTagSchema>;

export const TagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string().datetime()
});
export type Tag = z.infer<typeof TagSchema>;
