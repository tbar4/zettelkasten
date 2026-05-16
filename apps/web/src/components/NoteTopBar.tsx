import type { Note } from "@zk/shared";
import { useNavigate } from "@tanstack/react-router";
import { TagEditor } from "./TagEditor";

interface NoteTopBarProps {
  note: Note;
  onBack: () => void;
}

export function NoteTopBar({ note, onBack }: NoteTopBarProps) {
  const navigate = useNavigate();
  return (
    <div className="note-top-bar">
      <button onClick={onBack}>← Back</button>
      <span className="note-type-chip">{note.type}</span>
      <TagEditor noteId={note.id} tags={note.tags} />
      {note.type === "topic" && (
        <button
          onClick={() =>
            void navigate({ to: "/topics/$noteId/canvas", params: { noteId: note.id } })
          }
          style={{ marginLeft: 8 }}
        >
          Open canvas
        </button>
      )}
      <span style={{ marginLeft: "auto", color: "#888" }}>
        updated {new Date(note.updated_at).toLocaleString()}
      </span>
    </div>
  );
}
