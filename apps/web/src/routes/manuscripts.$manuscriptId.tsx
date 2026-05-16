import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { ManuscriptView } from "../components/ManuscriptView";

export const Route = createFileRoute("/manuscripts/$manuscriptId")({
  component: ManuscriptDetailPage
});

function ManuscriptDetailPage() {
  const { manuscriptId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const manuscriptQuery = useQuery({
    queryKey: ["manuscripts", manuscriptId],
    queryFn: () => api.getManuscript(manuscriptId)
  });

  const [title, setTitle] = useState("");
  const [anchorInput, setAnchorInput] = useState("");
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  useEffect(() => {
    if (manuscriptQuery.data && hydratedFor !== manuscriptQuery.data.id) {
      setTitle(manuscriptQuery.data.title);
      setHydratedFor(manuscriptQuery.data.id);
    }
  }, [manuscriptQuery.data, hydratedFor]);

  const topicsQuery = useQuery({
    queryKey: ["notes", "type", "topic"],
    queryFn: () => api.listNotes({ type: "topic" })
  });

  const updateMutation = useMutation({
    mutationFn: () => api.updateManuscript(manuscriptId, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] })
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteManuscript(manuscriptId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["manuscripts"] });
      navigate({ to: "/manuscripts" });
    }
  });

  const setAnchorTopicsMutation = useMutation({
    mutationFn: (anchorTopicIds: string[]) =>
      api.updateManuscript(manuscriptId, { anchorTopicIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId] });
      qc.invalidateQueries({ queryKey: ["manuscripts", manuscriptId, "anchor-links"] });
    }
  });

  if (manuscriptQuery.isLoading) return <p>Loading…</p>;
  if (manuscriptQuery.isError)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load: {String(manuscriptQuery.error)}
      </p>
    );
  if (!manuscriptQuery.data) return null;

  const manuscript = manuscriptQuery.data;
  const topicNotes = topicsQuery.data?.notes ?? [];
  const currentAnchorIds = manuscript.anchor_topic_ids;

  function removeAnchor(id: string) {
    setAnchorTopicsMutation.mutate(currentAnchorIds.filter((a) => a !== id));
  }

  function addAnchor(id: string) {
    if (!currentAnchorIds.includes(id)) {
      setAnchorTopicsMutation.mutate([...currentAnchorIds, id]);
    }
  }

  const anchorTitles = topicNotes
    .filter((n) => currentAnchorIds.includes(n.id))
    .map((n) => ({ id: n.id, title: n.title }));

  const availableTopics = topicNotes.filter(
    (n) =>
      !currentAnchorIds.includes(n.id) &&
      n.title.toLowerCase().includes(anchorInput.toLowerCase())
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ fontSize: 20, fontWeight: 600, flex: 1 }}
          onBlur={() => {
            if (title.trim() && title !== manuscript.title) {
              updateMutation.mutate();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) updateMutation.mutate();
          }}
        />
        <button
          onClick={() => {
            if (confirm("Delete this manuscript?")) deleteMutation.mutate();
          }}
          style={{ color: "#f7768e", fontSize: 13 }}
          disabled={deleteMutation.isPending}
        >
          Delete
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#888", marginRight: 8 }}>Anchor topics:</span>
        {anchorTitles.map((a) => (
          <span
            key={a.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginRight: 6,
              padding: "2px 8px",
              background: "#1a1a3a",
              borderRadius: 12,
              fontSize: 12
            }}
          >
            {a.title}
            <button
              style={{ fontSize: 10, color: "#f7768e", lineHeight: 1 }}
              onClick={() => removeAnchor(a.id)}
            >
              ×
            </button>
          </span>
        ))}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            position: "relative"
          }}
        >
          <input
            placeholder="Add topic…"
            value={anchorInput}
            onChange={(e) => setAnchorInput(e.target.value)}
            style={{ fontSize: 12, width: 120 }}
          />
          {anchorInput.length > 0 && availableTopics.length > 0 && (
            <ul
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                zIndex: 10,
                background: "#1a1b26",
                border: "1px solid #2a2a3a",
                listStyle: "none",
                padding: "4px 0",
                margin: 0,
                minWidth: 180,
                maxHeight: 160,
                overflowY: "auto"
              }}
            >
              {availableTopics.slice(0, 10).map((n) => (
                <li
                  key={n.id}
                  style={{ padding: "4px 12px", cursor: "pointer", fontSize: 12 }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addAnchor(n.id);
                    setAnchorInput("");
                  }}
                >
                  {n.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ManuscriptView manuscriptId={manuscriptId} />
    </div>
  );
}
