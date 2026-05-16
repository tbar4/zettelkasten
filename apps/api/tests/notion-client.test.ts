import { describe, it, expect, vi } from "vitest";
import { makeNotionClient } from "../src/notion/client";

describe("notionClient.listDatabasePages", () => {
  it("queries the database and returns pages", async () => {
    const fakeNotion = {
      databases: {
        query: vi.fn().mockResolvedValueOnce({
          results: [
            {
              object: "page",
              id: "page-1",
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "Hello" }]
                }
              }
            }
          ],
          has_more: false,
          next_cursor: null
        })
      }
    };
    const client = makeNotionClient(fakeNotion as never);
    const pages = await client.listDatabasePages("db-1");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.id).toBe("page-1");
    expect(fakeNotion.databases.query).toHaveBeenCalledWith({
      database_id: "db-1",
      start_cursor: undefined,
      page_size: 100
    });
  });

  it("paginates via next_cursor", async () => {
    const fakeNotion = {
      databases: {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            results: [{ object: "page", id: "page-1", properties: {} }],
            has_more: true,
            next_cursor: "cursor-1"
          })
          .mockResolvedValueOnce({
            results: [{ object: "page", id: "page-2", properties: {} }],
            has_more: false,
            next_cursor: null
          })
      }
    };
    const client = makeNotionClient(fakeNotion as never);
    const pages = await client.listDatabasePages("db-1");
    expect(pages.map((p) => p.id)).toEqual(["page-1", "page-2"]);
    expect(fakeNotion.databases.query).toHaveBeenCalledTimes(2);
  });
});

describe("notionClient.listBlockChildren", () => {
  it("returns block children", async () => {
    const fakeNotion = {
      blocks: {
        children: {
          list: vi.fn().mockResolvedValueOnce({
            results: [
              {
                object: "block",
                id: "block-1",
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "hi" }] }
              }
            ],
            has_more: false,
            next_cursor: null
          })
        }
      }
    };
    const client = makeNotionClient(fakeNotion as never);
    const blocks = await client.listBlockChildren("page-1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe("block-1");
  });
});
