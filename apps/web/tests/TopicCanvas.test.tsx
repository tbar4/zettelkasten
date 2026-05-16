import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({
    onChange,
    initialData
  }: {
    onChange?: (elements: unknown[], state: unknown) => void;
    initialData?: unknown;
  }) => (
    <div data-testid="excalidraw-mock" data-initial={JSON.stringify(initialData)}>
      <button
        data-testid="trigger-change"
        onClick={() => onChange?.([{ id: "el1" }], { zoom: { value: 1 }, scrollX: 0, scrollY: 0 })}
      >
        Trigger Change
      </button>
    </div>
  )
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

vi.mock("../src/lib/api-client", () => ({
  api: {
    canvasByTopic: vi.fn(),
    listNotes: vi.fn(),
    updateCanvas: vi.fn(),
    addCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn()
  }
}));

import { api } from "../src/lib/api-client";
import { TopicCanvas } from "../src/components/TopicCanvas";

const TOPIC_NOTE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CANVAS_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const NON_TOPIC_NOTE_ID = "cccccccc-0000-0000-0000-000000000003";

const mockCanvas = {
  id: CANVAS_ID,
  topic_note_id: TOPIC_NOTE_ID,
  scene_data: null,
  viewport: null,
  theme: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  items: [],
  edges: []
};

const mockNotes = {
  notes: [
    { id: NON_TOPIC_NOTE_ID, title: "A fleeting note", type: "fleeting" }
  ]
};

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
  );
}

describe("TopicCanvas", () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    (api.canvasByTopic as ReturnType<typeof vi.fn>).mockResolvedValue(mockCanvas);
    (api.listNotes as ReturnType<typeof vi.fn>).mockResolvedValue(mockNotes);
    (api.updateCanvas as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockCanvas,
      scene_data: JSON.stringify({ elements: [{ id: "el1" }] })
    });
    (api.addCanvasItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "item-1",
      canvas_id: CANVAS_ID,
      note_id: NON_TOPIC_NOTE_ID,
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      color: null,
      z_index: 0,
      created_at: "2026-01-01T00:00:00Z"
    });
  });

  it("fetches the canvas for the given topic note id", async () => {
    renderWithQuery(<TopicCanvas topicNoteId={TOPIC_NOTE_ID} />);
    await waitFor(() => {
      expect(api.canvasByTopic).toHaveBeenCalledWith(TOPIC_NOTE_ID);
    });
  });

  it("renders the Excalidraw component when canvas is loaded", async () => {
    renderWithQuery(<TopicCanvas topicNoteId={TOPIC_NOTE_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("excalidraw-mock")).toBeTruthy();
    });
  });

  it("renders the Add to canvas button", async () => {
    renderWithQuery(<TopicCanvas topicNoteId={TOPIC_NOTE_ID} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add to canvas/i })).toBeTruthy();
    });
  });

  it("calls api.addCanvasItem when Add to canvas is pressed with a note selected", async () => {
    renderWithQuery(<TopicCanvas topicNoteId={TOPIC_NOTE_ID} />);
    await waitFor(() =>
      screen.getByRole("button", { name: /add to canvas/i })
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: NON_TOPIC_NOTE_ID } });

    fireEvent.click(screen.getByRole("button", { name: /add to canvas/i }));
    await waitFor(() => {
      expect(api.addCanvasItem).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.objectContaining({ noteId: NON_TOPIC_NOTE_ID })
      );
    });
  });

  it("debounces and calls api.updateCanvas on scene change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithQuery(<TopicCanvas topicNoteId={TOPIC_NOTE_ID} />);
      await waitFor(() => screen.getByTestId("trigger-change"));

      fireEvent.click(screen.getByTestId("trigger-change"));
      expect(api.updateCanvas).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(api.updateCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.objectContaining({ scene_data: expect.any(String) })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
