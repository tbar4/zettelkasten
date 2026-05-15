import type { Note } from "@zk/shared";

interface NoteTopBarProps {
  note: Note;
  onBack: () => void;
}

export function NoteTopBar({ note, onBack }: NoteTopBarProps) {
  return (
    <div className="note-top-bar">
      <button onClick={onBack}>← Back</button>
      <span className="note-type-chip">{note.type}</span>
      {note.tags.map((t) => (
        <span key={t} className="tag-chip">
          {t}
        </span>
      ))}
      <span style={{ marginLeft: "auto", color: "#888" }}>
        updated {new Date(note.updated_at).toLocaleString()}
      </span>
    </div>
  );
}
