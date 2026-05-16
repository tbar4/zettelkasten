import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api-client";

export const Route = createFileRoute("/manuscripts")({
  component: ManuscriptsPage
});

function ManuscriptsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const listQuery = useQuery({
    queryKey: ["manuscripts"],
    queryFn: () => api.listManuscripts()
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const title = window.prompt("Manuscript title:");
      if (!title?.trim()) return null;
      return api.createManuscript({ title: title.trim() });
    },
    onSuccess: (result) => {
      if (result) {
        qc.invalidateQueries({ queryKey: ["manuscripts"] });
      }
    }
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Manuscripts</h2>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "Creating…" : "+ New manuscript"}
        </button>
      </div>

      {listQuery.isLoading && <p>Loading…</p>}
      {listQuery.isError && (
        <p style={{ color: "#f7768e" }}>Failed to load: {String(listQuery.error)}</p>
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {listQuery.data?.manuscripts.map((m) => (
          <li key={m.id} style={{ marginBottom: 8 }}>
            <Link
              to="/manuscripts/$manuscriptId"
              params={{ manuscriptId: m.id }}
              style={{ fontWeight: 500 }}
            >
              {m.title}
            </Link>
            <span style={{ marginLeft: 12, color: "#888", fontSize: 12 }}>
              {m.section_count} section{m.section_count !== 1 ? "s" : ""}
              {m.anchor_count > 0 ? ` · ${m.anchor_count} anchor topic${m.anchor_count !== 1 ? "s" : ""}` : ""}
            </span>
          </li>
        ))}
        {listQuery.data?.manuscripts.length === 0 && (
          <li style={{ color: "#888" }}>No manuscripts yet. Create one to get started.</li>
        )}
      </ul>
    </div>
  );
}
