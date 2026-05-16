import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { api } from "../lib/api-client";

interface RelatedNotesPanelProps {
  noteId: string;
}

export function RelatedNotesPanel({ noteId }: RelatedNotesPanelProps) {
  // Track when results were surfaced so we can send it with feedback
  const surfacedAtRef = useRef<string>(new Date().toISOString());

  const query = useQuery({
    queryKey: ["notes", noteId, "related"],
    queryFn: () => {
      surfacedAtRef.current = new Date().toISOString();
      return api.getRelatedNotes(noteId, 8);
    }
  });

  function handleAccepted(toNoteId: string) {
    void api.postSuggestionFeedback({
      fromNoteId: noteId,
      toNoteId,
      action: "accepted",
      surfacedAt: surfacedAtRef.current
    });
  }

  function handleRejected(toNoteId: string) {
    void api.postSuggestionFeedback({
      fromNoteId: noteId,
      toNoteId,
      action: "rejected",
      surfacedAt: surfacedAtRef.current
    });
  }

  // Hide entirely when no embedding is available
  if (query.data?.reason === "no-embedding") {
    return null;
  }

  if (query.isLoading) {
    return (
      <div className="related-notes-panel">
        <h4>Related Notes</h4>
        <p style={{ color: "#666", fontSize: 12 }}>Loading…</p>
      </div>
    );
  }

  if (query.isError) {
    return null;
  }

  const results = query.data?.results ?? [];

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="related-notes-panel">
      <h4>Related Notes</h4>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {results.map((note) => (
          <li
            key={note.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 0",
              borderBottom: "1px solid #2a2a3a"
            }}
          >
            <Link
              to="/notes/$noteId"
              params={{ noteId: note.id }}
              onClick={() => handleAccepted(note.id)}
              style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {note.title}
            </Link>
            <span style={{ color: "#888", fontSize: 11, whiteSpace: "nowrap" }}>
              {note.type}
            </span>
            <span style={{ color: "#7aa2f7", fontSize: 11, whiteSpace: "nowrap" }}>
              {Math.round(note.similarity * 100)}%
            </span>
            <button
              onClick={() => handleRejected(note.id)}
              title="Not relevant"
              style={{
                background: "transparent",
                border: "none",
                color: "#555",
                cursor: "pointer",
                fontSize: 12,
                padding: "0 2px",
                lineHeight: 1
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
