import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";

// Reset module singleton between tests by re-importing after resetting
// The fake-indexeddb/auto import above must come before outbox to polyfill IndexedDB

let outbox: typeof import("../src/lib/outbox");

beforeEach(async () => {
  // Dynamically import to get the module each time
  // Since fake-indexeddb is auto-installed globally, we can just reset the db singleton
  outbox = await import("../src/lib/outbox");
  outbox._resetDb();
  await outbox.clearAll();
});

describe("outbox", () => {
  it("enqueueNote adds a record to pending", async () => {
    await outbox.enqueueNote({ title: "Test note", body_md: "body text" });
    const pending = await outbox.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: "fleeting-note",
      body: { title: "Test note", body_md: "body text" }
    });
    expect(pending[0]!.createdAt).toBeTruthy();
  });

  it("listPending returns all queued items", async () => {
    await outbox.enqueueNote({ title: "Note 1" });
    await outbox.enqueueNote({ title: "Note 2" });
    const pending = await outbox.listPending();
    expect(pending).toHaveLength(2);
    expect(pending.map((r) => r.body.title)).toEqual(["Note 1", "Note 2"]);
  });

  it("markFlushed removes a specific record by id", async () => {
    await outbox.enqueueNote({ title: "To flush" });
    await outbox.enqueueNote({ title: "To keep" });
    const pending = await outbox.listPending();
    const toFlush = pending.find((r) => r.body.title === "To flush");
    expect(toFlush).toBeDefined();
    await outbox.markFlushed(toFlush!.id!);
    const remaining = await outbox.listPending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.body.title).toBe("To keep");
  });

  it("clearAll removes all pending records", async () => {
    await outbox.enqueueNote({ title: "A" });
    await outbox.enqueueNote({ title: "B" });
    await outbox.clearAll();
    const pending = await outbox.listPending();
    expect(pending).toHaveLength(0);
  });

  it("enqueueNote without body_md works", async () => {
    await outbox.enqueueNote({ title: "Title only" });
    const pending = await outbox.listPending();
    expect(pending[0]!.body.body_md).toBeUndefined();
  });
});
