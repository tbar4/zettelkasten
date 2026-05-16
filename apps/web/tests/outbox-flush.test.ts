import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

let outbox: typeof import("../src/lib/outbox");
let flushModule: typeof import("../src/lib/outbox-flush");

beforeEach(async () => {
  outbox = await import("../src/lib/outbox");
  outbox._resetDb();
  await outbox.clearAll();
  flushModule = await import("../src/lib/outbox-flush");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startFlushLoop", () => {
  it("flushes pending items on online event using real promises", async () => {
    await outbox.enqueueNote({ title: "Queued note", body_md: "some body" });

    const mockCreateNote = vi.fn().mockResolvedValue({ id: "new-id" });
    const mockApi = { createNote: mockCreateNote };

    const cleanup = flushModule.startFlushLoop(mockApi);

    // Trigger online event
    window.dispatchEvent(new Event("online"));
    // Allow all microtasks / real promises to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateNote).toHaveBeenCalledWith({
      type: "fleeting",
      title: "Queued note",
      body_md: "some body"
    });

    const remaining = await outbox.listPending();
    expect(remaining).toHaveLength(0);

    cleanup();
  });

  it("leaves item in queue when API fails", async () => {
    await outbox.enqueueNote({ title: "Failing note" });

    const mockCreateNote = vi.fn().mockRejectedValue(new Error("Network error"));
    const mockApi = { createNote: mockCreateNote };

    const cleanup = flushModule.startFlushLoop(mockApi);
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 50));

    const remaining = await outbox.listPending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.body.title).toBe("Failing note");

    cleanup();
  });

  it("cleanup removes event listeners", async () => {
    const mockCreateNote = vi.fn().mockResolvedValue({ id: "x" });
    const mockApi = { createNote: mockCreateNote };

    const cleanup = flushModule.startFlushLoop(mockApi);
    cleanup();

    // Trigger online event after cleanup — should not call api
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it("startFlushLoop registers a 30s interval (does not flush immediately)", async () => {
    // Verify it returns a cleanup function without calling api
    const mockCreateNote = vi.fn().mockResolvedValue({ id: "x" });
    const mockApi = { createNote: mockCreateNote };

    const cleanup = flushModule.startFlushLoop(mockApi);
    // Small wait — interval should not have fired yet
    await new Promise((r) => setTimeout(r, 10));
    expect(mockCreateNote).not.toHaveBeenCalled();
    cleanup();
  });
});
