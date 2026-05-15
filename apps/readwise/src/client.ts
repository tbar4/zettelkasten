import { z } from "zod";

const HighlightSchema = z.object({
  id: z.number(),
  text: z.string(),
  note: z.string().nullable().optional(),
  location: z.number().nullable().optional(),
  location_type: z.string().nullable().optional(),
  highlighted_at: z.string().nullable().optional(),
  color: z.string().nullable().optional()
});

const BookSchema = z.object({
  user_book_id: z.number(),
  title: z.string(),
  author: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  asin: z.string().nullable().optional(),
  highlights: z.array(HighlightSchema)
});

const ExportResponse = z.object({
  count: z.number(),
  nextPageCursor: z.string().nullable(),
  results: z.array(BookSchema)
});

export type ReadwiseHighlight = z.infer<typeof HighlightSchema>;
export type ReadwiseBook = z.infer<typeof BookSchema>;

export interface ReadwiseClient {
  exportHighlights(opts?: {
    pageCursor?: string;
    updatedAfter?: string;
  }): Promise<{
    books: ReadwiseBook[];
    nextPageCursor: string | null;
  }>;
}

export function readwiseClient(opts: {
  token: string;
  baseUrl: string;
}): ReadwiseClient {
  return {
    async exportHighlights({ pageCursor, updatedAfter } = {}) {
      const url = new URL(`${opts.baseUrl}/export/`);
      if (pageCursor) url.searchParams.set("pageCursor", pageCursor);
      if (updatedAfter) url.searchParams.set("updatedAfter", updatedAfter);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Token ${opts.token}`,
          Accept: "application/json"
        }
      });
      if (!res.ok) {
        throw new Error(
          `readwise: export request failed (${res.status} ${res.statusText})`
        );
      }
      const json = await res.json();
      const parsed = ExportResponse.parse(json);
      return {
        books: parsed.results,
        nextPageCursor: parsed.nextPageCursor
      };
    }
  };
}
