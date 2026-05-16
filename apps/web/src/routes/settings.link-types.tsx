import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api-client";

export const Route = createFileRoute("/settings/link-types")({
  component: LinkTypesPage
});

type CustomLinkType = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

function LinkTypesPage() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["custom-link-types"],
    queryFn: () => api.listCustomLinkTypes()
  });

  const createMutation = useMutation({
    mutationFn: () => api.createCustomLinkType({ name: newName.trim(), description: newDesc.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-link-types"] });
      setNewName("");
      setNewDesc("");
      setError(null);
    },
    onError: (err) => setError(String(err))
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.updateCustomLinkType(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-link-types"] });
      setEditingId(null);
      setError(null);
    },
    onError: (err) => setError(String(err))
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCustomLinkType(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-link-types"] });
      setDeleteConfirmId(null);
      setError(null);
    },
    onError: (err) => setError(String(err))
  });

  const types: CustomLinkType[] = listQuery.data?.customLinkTypes ?? [];

  return (
    <div>
      <h2>Custom Link Types</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Define custom relationship types to supplement the built-in link types.
      </p>

      {error && <p style={{ color: "#f7768e" }}>{error}</p>}

      <div style={{ marginBottom: 24 }}>
        <h3>Add new type</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Name (e.g. inspires)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <input
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            style={{ flex: 2, minWidth: 200 }}
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!newName.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>

      {listQuery.isLoading ? (
        <p style={{ color: "#666" }}>Loading…</p>
      ) : types.length === 0 ? (
        <p style={{ color: "#666" }}>No custom link types yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {types.map((t) => (
            <li
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 0",
                borderBottom: "1px solid #2a2a3a"
              }}
            >
              {editingId === t.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button
                    onClick={() =>
                      renameMutation.mutate({ id: t.id, name: editName.trim() })
                    }
                    disabled={!editName.trim() || renameMutation.isPending}
                  >
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)}>Cancel</button>
                </>
              ) : deleteConfirmId === t.id ? (
                <>
                  <span style={{ flex: 1 }}>
                    Delete <strong>{t.name}</strong>? This will remove it from all links.
                  </span>
                  <button
                    onClick={() => deleteMutation.mutate(t.id)}
                    disabled={deleteMutation.isPending}
                    style={{ color: "#f7768e" }}
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Confirm"}
                  </button>
                  <button onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }}>
                    <strong>{t.name}</strong>
                    {t.description && (
                      <span style={{ color: "#888", marginLeft: 8, fontSize: 13 }}>
                        {t.description}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => {
                      setEditingId(t.id);
                      setEditName(t.name);
                    }}
                  >
                    Rename
                  </button>
                  <button onClick={() => setDeleteConfirmId(t.id)}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
