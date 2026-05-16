import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface RelatedNotesPanelProps {
  noteId: string;
}

export function RelatedNotesPanel({ noteId }: RelatedNotesPanelProps) {
  const query = useQuery({
    queryKey: ["notes", noteId, "related"],
    queryFn: () => api.getRelatedNotes(noteId, 8)
  });

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
          </li>
        ))}
      </ul>
    </div>
  );
}
