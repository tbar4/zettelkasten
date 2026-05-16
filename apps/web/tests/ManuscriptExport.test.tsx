import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock TanStack Router's Link so we don't need router context
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string; params?: Record<string, string> }) => (
      <a {...props}>{children}</a>
    )
  };
});

// Mock the api-client
vi.mock("../src/lib/api-client", () => ({
  api: {
    getManuscript: vi.fn(),
    getNoteLinks: vi.fn().mockResolvedValue({ outgoing: [], incoming: [] }),
    listNoteSummariesByIds: vi.fn().mockResolvedValue({ notes: [] }),
    manuscriptExportUrl: vi.fn(
      (id: string, format: string) => `/api/manuscripts/${id}/export?format=${format}`
    )
  }
}));

import { api } from "../src/lib/api-client";
import { ManuscriptView } from "../src/components/ManuscriptView";

const MANUSCRIPT_ID = "m1";

const mockManuscript = {
  id: MANUSCRIPT_ID,
  title: "My Paper",
  anchor_topic_ids: [],
  body_md: null,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  sections: []
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("ManuscriptView – ExportDropdown", () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    vi.mocked(api.getManuscript).mockResolvedValue(mockManuscript);
    vi.mocked(api.manuscriptExportUrl).mockImplementation(
      (id, format) => `/api/manuscripts/${id}/export?format=${format}`
    );
  });

  async function renderAndWait() {
    render(<ManuscriptView manuscriptId={MANUSCRIPT_ID} />, { wrapper: makeWrapper() });
    // Wait for the manuscript data to load (loading indicator disappears)
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });
  }

  it("renders the export dropdown with three buttons", async () => {
    await renderAndWait();

    expect(screen.getByTestId("export-md")).toBeInTheDocument();
    expect(screen.getByTestId("export-latex")).toBeInTheDocument();
    expect(screen.getByTestId("export-docx")).toBeInTheDocument();
  });

  it("clicking Markdown sets window.location.href", async () => {
    // jsdom allows overriding location.href
    const originalLocation = window.location;
    // @ts-expect-error – overriding read-only in test
    delete window.location;
    window.location = { ...originalLocation, href: "" } as Location;

    await renderAndWait();
    fireEvent.click(screen.getByTestId("export-md"));

    expect(window.location.href).toBe(`/api/manuscripts/${MANUSCRIPT_ID}/export?format=md`);

    window.location = originalLocation;
  });

  it("shows error when latex export returns 503", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Pandoc not installed" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    );

    await renderAndWait();
    fireEvent.click(screen.getByTestId("export-latex"));

    await waitFor(() => {
      expect(screen.getByTestId("export-error")).toHaveTextContent("Pandoc not installed");
    });
  });

  it("shows error when docx export returns 503", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Pandoc not installed" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    );

    await renderAndWait();
    fireEvent.click(screen.getByTestId("export-docx"));

    await waitFor(() => {
      expect(screen.getByTestId("export-error")).toHaveTextContent("Pandoc not installed");
    });
  });

  it("triggers blob download for successful latex export", async () => {
    const blob = new Blob(["\\documentclass{article}"], { type: "application/x-tex" });
    fetchMock.mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: {
          "content-type": "application/x-tex",
          "content-disposition": 'attachment; filename="my-paper.tex"'
        }
      })
    );

    const createObjUrl = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjUrl = vi.fn();
    window.URL.createObjectURL = createObjUrl;
    window.URL.revokeObjectURL = revokeObjUrl;

    // Render first, then set up spies so React's DOM insertion isn't intercepted
    await renderAndWait();

    const appendSpy = vi.spyOn(document.body, "appendChild").mockImplementation((el) => el);
    const removeSpy = vi.spyOn(document.body, "removeChild").mockImplementation((el) => el);

    fireEvent.click(screen.getByTestId("export-latex"));

    await waitFor(() => {
      expect(createObjUrl).toHaveBeenCalled();
    });

    // No error shown
    expect(screen.queryByTestId("export-error")).not.toBeInTheDocument();

    appendSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
