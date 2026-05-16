import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export const Route = createFileRoute("/settings/sources")({
  component: SourcesSettingsPage
});

function SourcesSettingsPage() {
  const statsQuery = useQuery({
    queryKey: ["sources-stats"],
    queryFn: () => api.listSourcesStats()
  });

  const lastUpdated = statsQuery.data?.last_updated
    ? new Date(statsQuery.data.last_updated).toLocaleString()
    : null;

  return (
    <div>
      <h2>Sources</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Sources are reading materials imported from Readwise and linked to your notes.
      </p>

      {statsQuery.isLoading ? (
        <p style={{ color: "#666" }}>Loading…</p>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <p>
            <strong>{statsQuery.data?.count ?? 0}</strong> sources in your library
          </p>
          {lastUpdated && (
            <p style={{ color: "#888", fontSize: 13 }}>Last updated: {lastUpdated}</p>
          )}
        </div>
      )}

      <button
        onClick={() => {
          window.location.href = api.bibtexUrl();
        }}
        disabled={statsQuery.isLoading || (statsQuery.data?.count ?? 0) === 0}
      >
        Download .bib
      </button>
    </div>
  );
}
