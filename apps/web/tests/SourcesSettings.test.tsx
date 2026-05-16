import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: (_path: string) => (opts: { component: React.ComponentType }) => opts
  };
});

vi.mock("../src/lib/api-client", () => ({
  api: {
    listSourcesStats: vi.fn(),
    bibtexUrl: vi.fn().mockReturnValue("/api/sources/bibtex")
  }
}));

import { api } from "../src/lib/api-client";
import { Route } from "../src/routes/settings.sources";

const Component = Route.component as React.ComponentType;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SourcesSettingsPage", () => {
  it("shows source count from API", async () => {
    vi.mocked(api.listSourcesStats).mockResolvedValue({ count: 42, last_updated: null });
    render(<Component />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/42/)).toBeInTheDocument();
    });
  });

  it("shows last-updated timestamp when present", async () => {
    vi.mocked(api.listSourcesStats).mockResolvedValue({
      count: 5,
      last_updated: "2024-06-15T10:00:00.000Z"
    });
    render(<Component />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/Last updated/)).toBeInTheDocument();
    });
  });

  it("omits last-updated when null", async () => {
    vi.mocked(api.listSourcesStats).mockResolvedValue({ count: 3, last_updated: null });
    render(<Component />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
    });
  });

  it("disables download button when count is 0", async () => {
    vi.mocked(api.listSourcesStats).mockResolvedValue({ count: 0, last_updated: null });
    render(<Component />, { wrapper: makeWrapper() });
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Download .bib/i });
      expect(btn).toBeDisabled();
    });
  });

  it("enables download button when sources exist", async () => {
    vi.mocked(api.listSourcesStats).mockResolvedValue({ count: 3, last_updated: null });
    render(<Component />, { wrapper: makeWrapper() });
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Download .bib/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("sets window.location.href to bibtex url when button clicked", async () => {
    vi.mocked(api.listSourcesStats).mockResolvedValue({ count: 1, last_updated: null });
    vi.mocked(api.bibtexUrl).mockReturnValue("/api/sources/bibtex");

    let capturedHref = "";
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { ...window.location, set href(v: string) { capturedHref = v; } }
    });

    render(<Component />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Download .bib/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Download .bib/i }));
    expect(capturedHref).toBe("/api/sources/bibtex");
  });
});
