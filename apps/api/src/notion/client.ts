import type { Client } from "@notionhq/client";

// Permissive shapes — we read fields that exist on responses but the SDK types
// are unions across many block/property variants. Trust the SDK at call sites
// that care; this layer just shovels pages around.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotionPage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotionBlock = any;

export interface NotionClient {
  listDatabasePages(databaseId: string): Promise<NotionPage[]>;
  listBlockChildren(pageId: string): Promise<NotionBlock[]>;
}

export function makeNotionClient(notion: Client): NotionClient {
  return {
    async listDatabasePages(databaseId) {
      const pages: NotionPage[] = [];
      let cursor: string | undefined = undefined;
      do {
        const res = await notion.databases.query({
          database_id: databaseId,
          start_cursor: cursor,
          page_size: 100
        });
        pages.push(...res.results);
        cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
      } while (cursor);
      return pages;
    },
    async listBlockChildren(pageId) {
      const blocks: NotionBlock[] = [];
      let cursor: string | undefined = undefined;
      do {
        const res = await notion.blocks.children.list({
          block_id: pageId,
          start_cursor: cursor,
          page_size: 100
        });
        blocks.push(...res.results);
        cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
      } while (cursor);
      return blocks;
    }
  };
}
