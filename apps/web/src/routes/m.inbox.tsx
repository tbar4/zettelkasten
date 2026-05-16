import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api-client";

export const Route = createFileRoute("/m/inbox")({
  component: MobileInboxPage
});

const cardStyle: React.CSSProperties = {
  background: "#1e2030",
  border: "1px solid #333",
  borderRadius: 10,
  padding: "14px 16px",
  marginBottom: 10,
  cursor: "pointer"
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#7aa2f7",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: "20px 0 10px"
};

const actionBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 14,
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  fontWeight: 600
};

function FleetingCard({
  note
}: {
  note: { id: string; title: string; type: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const promoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const n = await api.getNote(noteId);
      return api.promoteToPermanent(noteId, n.updated_at);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
    }
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.archiveNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
    }
  });

  const busy =
    promoteMutation.isPending || archiveMutation.isPending;

  return (
    <div style={cardStyle} onClick={() => setExpanded((v) => !v)}>
      <div style={{ fontSize: 16, color: "#c0caf5" }}>{note.title}</div>
      {expanded && (
        <div
          style={{ marginTop: 12, display: "flex", gap: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={{ ...actionBtnStyle, background: "#7aa2f7", color: "#1a1b26" }}
            disabled={busy}
            onClick={() => promoteMutation.mutate(note.id)}
          >
            Promote
          </button>
          <button
            style={{ ...actionBtnStyle, background: "#3d3d3d", color: "#c0caf5" }}
            disabled={busy}
            onClick={() => archiveMutation.mutate(note.id)}
          >
            Archive
          </button>
          <a
            href={`/notes/${note.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...actionBtnStyle,
              background: "transparent",
              color: "#7aa2f7",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            Open
          </a>
        </div>
      )}
    </div>
  );
}

function HighlightCard({
  highlight
}: {
  highlight: { id: string; text: string; source_title: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const promoteMutation = useMutation({
    mutationFn: (highlightId: string) => api.promoteHighlight(highlightId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
    }
  });

  const busy = promoteMutation.isPending;

  return (
    <div style={cardStyle} onClick={() => setExpanded((v) => !v)}>
      <div style={{ fontSize: 15, color: "#c0caf5", lineHeight: 1.4 }}>
        {highlight.text}
      </div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
        from {highlight.source_title}
      </div>
      {expanded && (
        <div
          style={{ marginTop: 12, display: "flex", gap: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={{ ...actionBtnStyle, background: "#7aa2f7", color: "#1a1b26" }}
            disabled={busy}
            onClick={() => promoteMutation.mutate(highlight.id)}
          >
            Promote
          </button>
        </div>
      )}
    </div>
  );
}

function MobileInboxPage() {
  const inboxQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.getInbox()
  });

  if (inboxQuery.isLoading) {
    return <p style={{ padding: 16, color: "#888" }}>Loading…</p>;
  }

  if (inboxQuery.isError || !inboxQuery.data) {
    return (
      <p style={{ padding: 16, color: "#f7768e" }}>
        Failed to load inbox
      </p>
    );
  }

  const { fleeting, highlights } = inboxQuery.data;

  return (
    <div style={{ padding: 16 }}>
      <p style={sectionHeadingStyle}>Fleeting ({fleeting.length})</p>
      {fleeting.length === 0 ? (
        <p style={{ color: "#555", fontSize: 14 }}>No fleeting notes.</p>
      ) : (
        fleeting.map((n) => <FleetingCard key={n.id} note={n} />)
      )}

      <p style={sectionHeadingStyle}>Highlights ({highlights.length})</p>
      {highlights.length === 0 ? (
        <p style={{ color: "#555", fontSize: 14 }}>No highlights to triage.</p>
      ) : (
        highlights.map((h) => <HighlightCard key={h.id} highlight={h} />)
      )}
    </div>
  );
}
