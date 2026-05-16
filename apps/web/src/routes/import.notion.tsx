import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api-client";
import { NotionImportPreview } from "../components/NotionImportPreview";

export const Route = createFileRoute("/import/notion")({
  component: NotionImportPage
});

function NotionImportPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [databaseId, setDatabaseId] = useState("");

  const previewMutation = useMutation({
    mutationFn: () => api.notionPreview(token, databaseId)
  });

  const commitMutation = useMutation({
    mutationFn: api.notionCommit,
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["notes"] });
      await qc.invalidateQueries({ queryKey: ["inbox"] });
      alert(
        `Imported ${result.inserted} new notes, updated ${result.updated} existing.`
      );
      navigate({ to: "/" });
    }
  });

  return (
    <div>
      <h2>Import from Notion</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Paste a Notion integration token and a database ID. The token is used for
        one request and is not stored.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="password"
          placeholder="Notion integration token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={{ flex: 2 }}
          autoComplete="off"
        />
        <input
          placeholder="Database ID"
          value={databaseId}
          onChange={(e) => setDatabaseId(e.target.value)}
          style={{ flex: 2 }}
        />
        <button
          onClick={() => previewMutation.mutate()}
          disabled={!token || !databaseId || previewMutation.isPending}
        >
          {previewMutation.isPending ? "Fetching…" : "Preview"}
        </button>
      </div>

      {previewMutation.isError && (
        <p style={{ color: "#f7768e" }}>
          Failed to fetch preview: {String(previewMutation.error)}
        </p>
      )}

      {previewMutation.data && (
        <NotionImportPreview
          initialPages={previewMutation.data.pages}
          onCommit={(pages) => commitMutation.mutate(pages)}
          committing={commitMutation.isPending}
        />
      )}
    </div>
  );
}
